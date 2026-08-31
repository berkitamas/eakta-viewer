#import "ES3MacBridge.h"

#import "ES3CapabilityStore.h"
#import "ES3EvidenceBroker.h"
#import "ES3TrustCacheStore.h"
#import <AppKit/AppKit.h>
#import <ReactCommon/RCTTurboModule.h>

using namespace facebook::react;

static NSString *const ES3MenuStateChangedNotification = @"ES3MenuStateChanged";

@interface ES3MacBridge ()
@property(nonatomic, strong) ES3CapabilityStore *capabilities;
@property(nonatomic, strong) ES3TrustCacheStore *trustCache;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableArray<ES3EvidenceRequest *> *> *activeEvidence;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *evidenceOrigins;
@property(nonatomic) BOOL nativeReady;
@end

@implementation ES3MacBridge

static __weak ES3MacBridge *ES3CurrentBridge;
static NSMutableArray<NSURL *> *ES3PendingFinderURLs;

RCT_EXPORT_MODULE(ES3MacBridge)

+ (void)initialize
{
  if (self == ES3MacBridge.class) ES3PendingFinderURLs = [NSMutableArray array];
}

- (instancetype)init
{
  if ((self = [super init])) {
    _capabilities = [ES3CapabilityStore new];
    _trustCache = [ES3TrustCacheStore new];
    _activeEvidence = [NSMutableDictionary dictionary];
    _evidenceOrigins = [NSMutableDictionary dictionary];
    ES3CurrentBridge = self;
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeES3MacBridgeSpecJSI>(params);
}

+ (void)enqueueFinderURL:(NSURL *)url
{
  dispatch_async(dispatch_get_main_queue(), ^{
    ES3MacBridge *bridge = ES3CurrentBridge;
    if (!bridge || !bridge.nativeReady) {
      [ES3PendingFinderURLs addObject:url];
      return;
    }
    [bridge.capabilities adoptURL:url completion:^(NSDictionary *value, NSError *error) {
      if (value && !error) [bridge emitOnOpenFile:value];
    }];
  });
}

+ (void)sendMenuCommand:(NSString *)command
{
  dispatch_async(dispatch_get_main_queue(), ^{
    ES3MacBridge *bridge = ES3CurrentBridge;
    if (bridge.nativeReady) [bridge emitOnMenuCommand:@{@"command": command}];
  });
}

- (void)resolveDictionary:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
                    value:(NSDictionary *)value
                    error:(NSError *)error
                     code:(NSString *)code
{
  if (error) reject(code, @"The native capability operation failed.", error);
  else resolve(value);
}

- (void)resolveVoid:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
              error:(NSError *)error
               code:(NSString *)code
{
  if (error) reject(code, @"The native capability operation failed.", error);
  else resolve(nil);
}

- (void)acknowledgeNativeReady:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self.nativeReady = YES;
    NSArray<NSURL *> *pending = [ES3PendingFinderURLs copy];
    [ES3PendingFinderURLs removeAllObjects];
    for (NSURL *url in pending) [ES3MacBridge enqueueFinderURL:url];
    resolve(nil);
  });
}

- (void)openDossier:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = NSOpenPanel.openPanel;
    panel.canChooseDirectories = NO;
    panel.allowsMultipleSelection = NO;
    panel.allowedFileTypes = @[@"es3"];
    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result != NSModalResponseOK || !panel.URL) {
        resolve(@{@"status": @"cancelled"});
        return;
      }
      [self.capabilities adoptURL:panel.URL completion:^(NSDictionary *value, NSError *error) {
        if (error) reject(@"open-failed", @"Unable to adopt the selected dossier.", error);
        else resolve(@{@"status": @"selected", @"input": value});
      }];
    }];
  });
}

- (void)adoptDroppedFile:(NSString *)uri resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSURL *url = ES3DroppedFileURL(uri);
  if (!url) {
    reject(@"drop-policy", @"Dropped input must be an absolute path or file URL.", nil);
    return;
  }
  [self.capabilities adoptURL:url completion:^(NSDictionary *value, NSError *error) {
    [self resolveDictionary:resolve reject:reject value:value error:error code:@"drop-failed"];
  }];
}

- (void)readInputChunk:(NSString *)inputToken offset:(double)offset length:(double)length resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.capabilities readInput:inputToken offset:offset length:length completion:^(NSDictionary *value, NSError *error) {
    [self resolveDictionary:resolve reject:reject value:value error:error code:@"input-read-failed"];
  }];
}

- (void)beginTemporaryFile:(NSString *)sessionId suggestedName:(NSString *)suggestedName resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.capabilities beginOutputForSession:sessionId suggestedName:suggestedName completion:^(NSDictionary *value, NSError *error) {
    [self resolveDictionary:resolve reject:reject value:value error:error code:@"output-begin-failed"];
  }];
}

- (void)appendTemporaryFile:(NSString *)outputToken sequence:(NSInteger)sequence dataBase64:(NSString *)dataBase64 resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.capabilities appendOutput:outputToken sequence:sequence base64:dataBase64 completion:^(NSError *error) {
    [self resolveVoid:resolve reject:reject error:error code:@"output-append-failed"];
  }];
}

- (void)finishTemporaryFile:(NSString *)outputToken resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.capabilities finishOutput:outputToken completion:^(NSDictionary *value, NSError *error) {
    [self resolveDictionary:resolve reject:reject value:value error:error code:@"output-finish-failed"];
  }];
}

- (NSURL *)collisionSafeURLInDirectory:(NSURL *)directory name:(NSString *)name
{
  NSString *safe = ES3SafeSuggestedName(name);
  NSString *extension = safe.pathExtension;
  NSString *stem = safe.stringByDeletingPathExtension;
  NSURL *candidate = [directory URLByAppendingPathComponent:safe];
  NSUInteger suffix = 2;
  while ([NSFileManager.defaultManager fileExistsAtPath:candidate.path]) {
    NSString *next = [NSString stringWithFormat:@"%@ (%lu)%@%@", stem, (unsigned long)suffix,
      extension.length ? @"." : @"", extension];
    candidate = [directory URLByAppendingPathComponent:next];
    suffix += 1;
  }
  return candidate;
}

- (void)exportFile:(NSString *)previewPath suggestedName:(NSString *)suggestedName resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSURL *source = [self.capabilities authorizedOutputURLForPath:previewPath];
    if (!source) {
      reject(@"unauthorized-export", @"The preview path is not an active output capability.", nil);
      return;
    }
    NSSavePanel *panel = NSSavePanel.savePanel;
    panel.nameFieldStringValue = ES3SafeSuggestedName(suggestedName);
    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result != NSModalResponseOK || !panel.URL) {
        resolve(@{@"status": @"cancelled", @"finalNames": @[], @"errors": @[]});
        return;
      }
      BOOL copied = [NSFileManager.defaultManager copyItemAtURL:source toURL:panel.URL error:nil];
      NSString *name = panel.URL.lastPathComponent ?: @"document";
      if (copied) resolve(@{@"status": @"exported", @"finalNames": @[name], @"errors": @[]});
      else resolve(@{@"status": @"partial", @"finalNames": @[],
                     @"errors": @[@{@"name": name, @"code": @"copy-failed"}]});
    }];
  });
}

- (void)exportFiles:(NSArray *)files resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = NSOpenPanel.openPanel;
    panel.canChooseFiles = NO;
    panel.canChooseDirectories = YES;
    panel.canCreateDirectories = YES;
    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result != NSModalResponseOK || !panel.URL) {
        resolve(@{@"status": @"cancelled", @"finalNames": @[], @"errors": @[]});
        return;
      }
      NSMutableArray *names = [NSMutableArray array];
      NSMutableArray *errors = [NSMutableArray array];
      for (NSDictionary *file in files) {
        NSString *name = ES3SafeSuggestedName(file[@"suggestedName"] ?: @"document");
        NSURL *source = [self.capabilities authorizedOutputURLForPath:file[@"previewPath"]];
        if (!source) {
          [errors addObject:@{@"name": name, @"code": @"unauthorized"}];
          continue;
        }
        NSURL *destination = [self collisionSafeURLInDirectory:panel.URL name:name];
        if ([NSFileManager.defaultManager copyItemAtURL:source toURL:destination error:nil]) {
          [names addObject:destination.lastPathComponent];
        } else {
          [errors addObject:@{@"name": name, @"code": @"copy-failed"}];
        }
      }
      resolve(@{@"status": errors.count ? @"partial" : @"exported",
                @"finalNames": names, @"errors": errors});
    }];
  });
}

- (void)cancelEvidenceForSession:(NSString *)sessionId
{
  @synchronized(self.activeEvidence) {
    for (ES3EvidenceRequest *request in [self.activeEvidence[sessionId] copy]) [request cancel];
    [self.activeEvidence removeObjectForKey:sessionId];
  }
  @synchronized(self.evidenceOrigins) {
    NSArray *tokens = [self.evidenceOrigins keysOfEntriesPassingTest:
      ^BOOL(NSString *token, NSDictionary *origin, BOOL *stop) {
        return [origin[@"sessionId"] isEqualToString:sessionId];
      }].allObjects;
    [self.evidenceOrigins removeObjectsForKeys:tokens];
  }
}

- (void)cancelSession:(NSString *)sessionId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self cancelEvidenceForSession:sessionId];
  [self.capabilities cancelSession:sessionId];
  resolve(nil);
}

- (void)cleanupSession:(NSString *)sessionId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self cancelEvidenceForSession:sessionId];
  [self.capabilities cleanupSession:sessionId completion:^(NSError *error) {
    [self resolveVoid:resolve reject:reject error:error code:@"cleanup-failed"];
  }];
}

- (void)loadTrustCache:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.trustCache load:^(NSDictionary *value, NSError *error) {
    NSString *cacheToken = error ? nil : value[@"cacheToken"];
    if (cacheToken.length) {
      @synchronized(self.evidenceOrigins) {
        self.evidenceOrigins[cacheToken] =
          @{@"sessionId": @"", @"kind": @"tsl", @"url": @"native-trust-cache"};
      }
    }
    [self resolveDictionary:resolve reject:reject value:value error:error code:@"cache-load-failed"];
  }];
}

- (void)readTrustCacheChunk:(NSString *)cacheToken part:(NSString *)part offset:(double)offset length:(double)length resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.trustCache read:cacheToken part:part offset:offset length:length completion:^(NSDictionary *value, NSError *error) {
    [self resolveDictionary:resolve reject:reject value:value error:error code:@"cache-read-failed"];
  }];
}

- (void)beginTrustCacheWrite:(JS::NativeES3MacBridge::TrustCacheMetadata &)metadata resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *value = @{@"schemaVersion": @(metadata.schemaVersion()), @"verifiedAt": metadata.verifiedAt(),
    @"lotlNextUpdate": metadata.lotlNextUpdate(), @"huTslNextUpdate": metadata.huTslNextUpdate(),
    @"lotlSha256": metadata.lotlSha256(), @"huTslSha256": metadata.huTslSha256(),
    @"lotlSize": @(metadata.lotlSize()), @"huTslSize": @(metadata.huTslSize())};
  [self.trustCache beginWrite:value completion:^(NSDictionary *result, NSError *error) {
    [self resolveDictionary:resolve reject:reject value:result error:error code:@"cache-begin-failed"];
  }];
}

- (void)appendTrustCachePart:(NSString *)writeToken part:(NSString *)part sequence:(NSInteger)sequence dataBase64:(NSString *)dataBase64 resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.trustCache appendWrite:writeToken part:part sequence:sequence base64:dataBase64 completion:^(NSError *error) {
    [self resolveVoid:resolve reject:reject error:error code:@"cache-append-failed"];
  }];
}

- (void)finishTrustCacheWrite:(NSString *)writeToken resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.trustCache finishWrite:writeToken completion:^(NSError *error) {
    [self resolveVoid:resolve reject:reject error:error code:@"cache-finish-failed"];
  }];
}

- (void)fetchEvidence:(JS::NativeES3MacBridge::EvidenceRequest &)request resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSString *sessionId = request.sessionId();
  NSString *kind = request.kind();
  NSString *urlString = request.url();
  NSString *method = request.method();
  NSString *bodyBase64 = request.bodyBase64();
  NSString *parentToken = request.parentCapabilityToken();
  NSString *stage = request.stage();
  NSURL *url = [NSURL URLWithString:urlString];
  NSDictionary *origin;
  @synchronized(self.evidenceOrigins) {
    origin = self.evidenceOrigins[parentToken];
    BOOL unboundTrustCache =
      [origin[@"kind"] isEqualToString:@"tsl"] &&
      [origin[@"sessionId"] isEqualToString:@""] &&
      [self.capabilities hasSession:sessionId];
    if (unboundTrustCache) {
      origin = @{@"sessionId": sessionId, @"kind": @"tsl",
                 @"url": @"native-trust-cache"};
      self.evidenceOrigins[parentToken] = origin;
    }
  }
  BOOL parentIsInput = [self.capabilities session:sessionId ownsInputToken:parentToken];
  BOOL originMatches = [origin[@"sessionId"] isEqualToString:sessionId];
  BOOL lotlAllowed = [stage isEqualToString:@"bootstrap"] && parentIsInput &&
    [kind isEqualToString:@"lotl"] &&
    [urlString isEqualToString:@"https://ec.europa.eu/tools/lotl/eu-lotl.xml"];
  BOOL tslAllowed = [stage isEqualToString:@"verified-lotl"] && originMatches &&
    [origin[@"kind"] isEqualToString:@"lotl"] && [kind isEqualToString:@"tsl"];
  BOOL aiaAllowed = [stage isEqualToString:@"linked-certificate"] && parentIsInput &&
    [kind isEqualToString:@"aia"];
  BOOL revocationAllowed = [stage isEqualToString:@"verified-chain"] &&
    originMatches && [origin[@"kind"] isEqualToString:@"tsl"] &&
    ([kind isEqualToString:@"ocsp"] || [kind isEqualToString:@"crl"]);
  NSData *body = bodyBase64.length
    ? [[NSData alloc] initWithBase64EncodedString:bodyBase64 options:0]
    : nil;
  BOOL methodAllowed = [method isEqualToString:@"GET"] && !bodyBase64.length;
  methodAllowed |= [method isEqualToString:@"POST"] && [kind isEqualToString:@"ocsp"] &&
    body.length > 0 && body.length <= 64 * 1024;
  if (!(lotlAllowed || tslAllowed || aiaAllowed || revocationAllowed) ||
      !methodAllowed || !ES3EndpointIsPublic(url)) {
    reject(@"evidence-policy", @"The evidence endpoint is not permitted.", nil);
    return;
  }
  NSMutableURLRequest *urlRequest = [NSMutableURLRequest requestWithURL:url];
  urlRequest.HTTPMethod = method;
  urlRequest.HTTPBody = body;
  if (body.length)
    [urlRequest setValue:@"application/ocsp-request" forHTTPHeaderField:@"Content-Type"];
  __block ES3EvidenceRequest *fetch;
  fetch = [[ES3EvidenceRequest alloc] initWithURLRequest:urlRequest completion:
    ^(NSData *data, NSString *mime, NSString *errorCode) {
      @synchronized(self.activeEvidence) {
        [self.activeEvidence[sessionId] removeObject:fetch];
      }
      if (errorCode || !data) {
        reject(@"evidence-fetch", @"Unable to retrieve validation evidence.", nil);
        return;
      }
      [self.capabilities storeEvidence:data mimeType:mime sessionId:sessionId
        completion:^(NSDictionary *value, NSError *error) {
          if (!error) {
            @synchronized(self.evidenceOrigins) {
              self.evidenceOrigins[value[@"evidenceToken"]] =
                @{@"sessionId": sessionId, @"kind": kind, @"url": urlString};
            }
          }
          [self resolveDictionary:resolve reject:reject value:value error:error
                             code:@"evidence-store-failed"];
        }];
    }];
  @synchronized(self.activeEvidence) {
    if (!self.activeEvidence[sessionId])
      self.activeEvidence[sessionId] = [NSMutableArray array];
    [self.activeEvidence[sessionId] addObject:fetch];
  }
}

- (void)readEvidenceChunk:(NSString *)evidenceToken offset:(double)offset length:(double)length resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self.capabilities readEvidence:evidenceToken offset:offset length:length completion:^(NSDictionary *value, NSError *error) {
    [self resolveDictionary:resolve reject:reject value:value error:error code:@"evidence-read-failed"];
  }];
}

- (void)releaseEvidence:(NSString *)evidenceToken resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  @synchronized(self.evidenceOrigins) {
    [self.evidenceOrigins removeObjectForKey:evidenceToken];
  }
  [self.capabilities releaseEvidence:evidenceToken completion:^(NSError *error) {
    [self resolveVoid:resolve reject:reject error:error code:@"evidence-release-failed"];
  }];
}

- (void)getLanguagePreference:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([NSUserDefaults.standardUserDefaults stringForKey:@"language"] ?: @"system");
}

- (void)setLanguagePreference:(NSString *)value resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  if (![@[@"system", @"en", @"hu"] containsObject:value]) {
    reject(@"invalid-language", @"Unsupported language preference.", nil);
    return;
  }
  [NSUserDefaults.standardUserDefaults setObject:value forKey:@"language"];
  resolve(nil);
}

- (void)setMenuState:(JS::NativeES3MacBridge::MenuState &)state resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  auto labels = state.labels();
  NSDictionary *payload = @{
    @"hasDossier": @(state.hasDossier()), @"hasSelectedExportable": @(state.hasSelectedExportable()),
    @"canExportAll": @(state.canExportAll()), @"inspectorVisible": @(state.inspectorVisible()),
    @"language": state.language(),
    @"labels": @{@"about": labels.about(), @"openDossier": labels.openDossier(),
      @"closeDossier": labels.closeDossier(), @"exportSelected": labels.exportSelected(),
      @"exportAll": labels.exportAll(), @"documents": labels.documents(), @"signatures": labels.signatures(),
      @"showInspector": labels.showInspector(), @"hideInspector": labels.hideInspector(),
      @"language": labels.language(), @"system": labels.system(), @"english": labels.english(),
      @"hungarian": labels.hungarian(), @"verificationPrivacy": labels.verificationPrivacy()},
  };
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSNotificationCenter.defaultCenter postNotificationName:ES3MenuStateChangedNotification object:nil userInfo:payload];
    resolve(nil);
  });
}

@end
