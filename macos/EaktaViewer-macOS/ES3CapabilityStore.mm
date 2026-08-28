#import "ES3CapabilityStore.h"

#include <sys/stat.h>

static const NSUInteger ES3MaxChunkBytes = 768 * 1024;
static NSString *const ES3ErrorDomain = @"hu.btj.eaktaviewer.native";

NSError *ES3CapabilityError(NSInteger code)
{
  return [NSError errorWithDomain:ES3ErrorDomain code:code userInfo:nil];
}

NSString *ES3SafeSuggestedName(NSString *name)
{
  NSString *last = name.lastPathComponent;
  if (!last.length || [last isEqualToString:@"."] || [last isEqualToString:@".."]) return @"document";
  return last;
}

NSURL *ES3DroppedFileURL(NSString *value)
{
  NSURL *candidate;
  if ([value hasPrefix:@"/"]) {
    candidate = [NSURL fileURLWithPath:value.stringByStandardizingPath isDirectory:NO];
  } else {
    candidate = [NSURL URLWithString:value];
  }
  if (!candidate.isFileURL || candidate.host.length) return nil;
  NSString *path = candidate.path.stringByStandardizingPath;
  if (![path isAbsolutePath]) return nil;
  return [NSURL fileURLWithPath:path isDirectory:NO];
}

@interface ES3CapabilityStore ()
@property(nonatomic, readwrite) dispatch_queue_t queue;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *inputs;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *outputs;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *evidence;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSURL *> *sessionRoots;
@end

@implementation ES3CapabilityStore

- (instancetype)init
{
  if ((self = [super init])) {
    _queue = dispatch_queue_create("hu.btj.eaktaviewer.capabilities", DISPATCH_QUEUE_SERIAL);
    _inputs = [NSMutableDictionary dictionary];
    _outputs = [NSMutableDictionary dictionary];
    _evidence = [NSMutableDictionary dictionary];
    _sessionRoots = [NSMutableDictionary dictionary];
    [self purgeStaleSessions];
  }
  return self;
}

- (NSURL *)sessionsBaseURL
{
  NSURL *base = [[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES]
    URLByAppendingPathComponent:@"hu.btj.eaktaviewer/sessions" isDirectory:YES];
  [NSFileManager.defaultManager createDirectoryAtURL:base withIntermediateDirectories:YES
                                           attributes:@{NSFilePosixPermissions: @0700} error:nil];
  chmod(base.fileSystemRepresentation, 0700);
  return base;
}

- (NSURL *)sessionRoot:(NSString *)sessionId create:(BOOL)create
{
  NSURL *root = self.sessionRoots[sessionId];
  if (root || !create) return root;
  root = [[self sessionsBaseURL] URLByAppendingPathComponent:sessionId isDirectory:YES];
  if (![NSFileManager.defaultManager createDirectoryAtURL:root withIntermediateDirectories:NO
                                                attributes:@{NSFilePosixPermissions: @0700} error:nil]) return nil;
  chmod(root.fileSystemRepresentation, 0700);
  self.sessionRoots[sessionId] = root;
  return root;
}

- (void)purgeStaleSessions
{
  dispatch_async(self.queue, ^{
    NSArray<NSURL *> *children = [NSFileManager.defaultManager contentsOfDirectoryAtURL:[self sessionsBaseURL]
      includingPropertiesForKeys:@[NSURLContentModificationDateKey]
                         options:NSDirectoryEnumerationSkipsHiddenFiles error:nil];
    NSDate *cutoff = [NSDate dateWithTimeIntervalSinceNow:-24 * 60 * 60];
    for (NSURL *child in children) {
      NSDate *modified;
      [child getResourceValue:&modified forKey:NSURLContentModificationDateKey error:nil];
      if (modified && [modified compare:cutoff] == NSOrderedAscending) {
        [NSFileManager.defaultManager removeItemAtURL:child error:nil];
      }
    }
  });
}

- (void)adoptURL:(NSURL *)url completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{
    if (!url.isFileURL) { completion(nil, ES3CapabilityError(1)); return; }
    BOOL scoped = [url startAccessingSecurityScopedResource];
    NSString *sessionId = NSUUID.UUID.UUIDString;
    NSString *token = NSUUID.UUID.UUIDString;
    NSURL *root = [self sessionRoot:sessionId create:YES];
    NSURL *snapshot = [root URLByAppendingPathComponent:@"input.es3"];
    NSError *error;
    BOOL copied = root && [NSFileManager.defaultManager copyItemAtURL:url toURL:snapshot error:&error];
    if (scoped) [url stopAccessingSecurityScopedResource];
    if (!copied) {
      if (root) [NSFileManager.defaultManager removeItemAtURL:root error:nil];
      completion(nil, error ?: ES3CapabilityError(2));
      return;
    }
    chmod(snapshot.fileSystemRepresentation, 0600);
    NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:snapshot.path error:&error];
    NSFileHandle *handle = [NSFileHandle fileHandleForReadingFromURL:snapshot error:&error];
    if (!handle || error) {
      [NSFileManager.defaultManager removeItemAtURL:root error:nil];
      completion(nil, error ?: ES3CapabilityError(3));
      return;
    }
    NSNumber *size = attributes[NSFileSize] ?: @0;
    self.inputs[token] = [@{@"sessionId": sessionId, @"url": snapshot, @"handle": handle,
                            @"size": size, @"nextOffset": @0, @"sequence": @0} mutableCopy];
    completion(@{@"sessionId": sessionId, @"inputToken": token,
                 @"displayName": url.lastPathComponent ?: @"dossier.es3", @"size": size}, nil);
  });
}

- (void)readRecord:(NSMutableDictionary *)record
            offset:(double)offset
            length:(double)length
        completion:(ES3DictionaryCompletion)completion
{
  if (!record || offset < 0 || length <= 0 || length > ES3MaxChunkBytes ||
      offset != [record[@"nextOffset"] doubleValue]) {
    completion(nil, ES3CapabilityError(4));
    return;
  }
  @try {
    NSFileHandle *handle = record[@"handle"];
    [handle seekToFileOffset:(unsigned long long)offset];
    NSData *data = [handle readDataOfLength:(NSUInteger)length];
    NSNumber *sequence = record[@"sequence"];
    record[@"sequence"] = @([sequence integerValue] + 1);
    record[@"nextOffset"] = @(offset + data.length);
    BOOL eof = offset + data.length >= [record[@"size"] doubleValue];
    completion(@{@"dataBase64": [data base64EncodedStringWithOptions:0],
                 @"eof": @(eof), @"sequence": sequence}, nil);
  } @catch (NSException *exception) {
    completion(nil, ES3CapabilityError(5));
  }
}

- (void)readInput:(NSString *)token offset:(double)offset length:(double)length completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{ [self readRecord:self.inputs[token] offset:offset length:length completion:completion]; });
}

- (void)beginOutputForSession:(NSString *)sessionId suggestedName:(NSString *)name completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSURL *root = [self sessionRoot:sessionId create:NO];
    if (!root) { completion(nil, ES3CapabilityError(12)); return; }
    NSString *token = NSUUID.UUID.UUIDString;
    NSString *safeName = ES3SafeSuggestedName(name);
    NSString *extension = safeName.pathExtension.lowercaseString;
    NSCharacterSet *nonAlphanumeric = NSCharacterSet.alphanumericCharacterSet.invertedSet;
    if (extension.length > 10 || [extension rangeOfCharacterFromSet:nonAlphanumeric].location != NSNotFound)
      extension = @"";
    NSString *temporaryName = extension.length
      ? [NSString stringWithFormat:@"output-%@.%@", token, extension]
      : [NSString stringWithFormat:@"output-%@", token];
    NSURL *url = [root URLByAppendingPathComponent:temporaryName];
    [NSFileManager.defaultManager createFileAtPath:url.path contents:nil attributes:@{NSFilePosixPermissions: @0600}];
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingToURL:url error:nil];
    if (!handle) { completion(nil, ES3CapabilityError(6)); return; }
    self.outputs[token] = [@{@"sessionId": sessionId, @"url": url, @"handle": handle,
                             @"sequence": @0, @"suggestedName": safeName} mutableCopy];
    completion(@{@"outputToken": token, @"previewPath": url.path}, nil);
  });
}

- (void)appendRecord:(NSMutableDictionary *)record
             sequence:(NSInteger)sequence
                base64:(NSString *)base64
            completion:(ES3VoidCompletion)completion
{
  if (!record || sequence != [record[@"sequence"] integerValue] ||
      [base64 lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 1024 * 1024) {
    completion(ES3CapabilityError(7));
    return;
  }
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  if (!data) { completion(ES3CapabilityError(8)); return; }
  @try { [(NSFileHandle *)record[@"handle"] writeData:data]; }
  @catch (NSException *exception) { completion(ES3CapabilityError(9)); return; }
  record[@"sequence"] = @(sequence + 1);
  completion(nil);
}

- (void)appendOutput:(NSString *)token sequence:(NSInteger)sequence base64:(NSString *)base64 completion:(ES3VoidCompletion)completion
{
  dispatch_async(self.queue, ^{ [self appendRecord:self.outputs[token] sequence:sequence base64:base64 completion:completion]; });
}

- (void)finishOutput:(NSString *)token completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSMutableDictionary *record = self.outputs[token];
    if (!record) { completion(nil, ES3CapabilityError(10)); return; }
    [(NSFileHandle *)record[@"handle"] closeFile];
    [record removeObjectForKey:@"handle"];
    chmod([(NSURL *)record[@"url"] fileSystemRepresentation], 0600);
    completion(@{@"previewPath": [(NSURL *)record[@"url"] path]}, nil);
  });
}

- (NSURL *)authorizedOutputURLForPath:(NSString *)path
{
  __block NSURL *authorized = nil;
  NSString *standard = path.stringByStandardizingPath;
  dispatch_sync(self.queue, ^{
    for (NSDictionary *record in self.outputs.allValues) {
      NSURL *url = record[@"url"];
      if ([url.path.stringByStandardizingPath isEqualToString:standard]) {
        authorized = url;
        break;
      }
    }
  });
  return authorized;
}

- (BOOL)hasSession:(NSString *)sessionId
{
  __block BOOL exists;
  dispatch_sync(self.queue, ^{ exists = self.sessionRoots[sessionId] != nil; });
  return exists;
}

- (BOOL)session:(NSString *)sessionId ownsInputToken:(NSString *)inputToken
{
  __block BOOL owns;
  dispatch_sync(self.queue, ^{
    owns = [self.inputs[inputToken][@"sessionId"] isEqualToString:sessionId];
  });
  return owns;
}

- (void)cancelSession:(NSString *)sessionId
{
  // File capabilities are revoked during cleanup after verifier cancellation acknowledgement.
}

- (void)cleanupSession:(NSString *)sessionId completion:(ES3VoidCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSArray *(^matchingKeys)(NSMutableDictionary *) = ^NSArray *(NSMutableDictionary *table) {
      return [table keysOfEntriesPassingTest:^BOOL(NSString *key, NSDictionary *record, BOOL *stop) {
        return [record[@"sessionId"] isEqualToString:sessionId];
      }].allObjects;
    };
    for (NSString *key in matchingKeys(self.inputs)) {
      [(NSFileHandle *)self.inputs[key][@"handle"] closeFile];
      [self.inputs removeObjectForKey:key];
    }
    for (NSString *key in matchingKeys(self.outputs)) {
      [(NSFileHandle *)self.outputs[key][@"handle"] closeFile];
      [self.outputs removeObjectForKey:key];
    }
    for (NSString *key in matchingKeys(self.evidence)) {
      [(NSFileHandle *)self.evidence[key][@"handle"] closeFile];
      [self.evidence removeObjectForKey:key];
    }
    NSURL *root = self.sessionRoots[sessionId];
    if (root) [NSFileManager.defaultManager removeItemAtURL:root error:nil];
    [self.sessionRoots removeObjectForKey:sessionId];
    completion(nil);
  });
}

- (void)storeEvidence:(NSData *)data mimeType:(NSString *)mime sessionId:(NSString *)sessionId completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSURL *root = [self sessionRoot:sessionId create:NO];
    if (!root) { completion(nil, ES3CapabilityError(13)); return; }
    NSString *token = NSUUID.UUID.UUIDString;
    NSURL *url = [root URLByAppendingPathComponent:[NSString stringWithFormat:@"evidence-%@", token]];
    if (![data writeToURL:url options:NSDataWritingAtomic error:nil]) {
      completion(nil, ES3CapabilityError(14));
      return;
    }
    chmod(url.fileSystemRepresentation, 0600);
    self.evidence[token] = [@{@"sessionId": sessionId, @"url": url,
      @"handle": [NSFileHandle fileHandleForReadingFromURL:url error:nil], @"size": @(data.length),
      @"nextOffset": @0, @"sequence": @0} mutableCopy];
    completion(@{@"evidenceToken": token, @"size": @(data.length), @"mimeType": mime}, nil);
  });
}

- (void)readEvidence:(NSString *)token offset:(double)offset length:(double)length completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{ [self readRecord:self.evidence[token] offset:offset length:length completion:completion]; });
}

- (void)releaseEvidence:(NSString *)token completion:(ES3VoidCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSDictionary *record = self.evidence[token];
    [(NSFileHandle *)record[@"handle"] closeFile];
    if (record[@"url"]) [NSFileManager.defaultManager removeItemAtURL:record[@"url"] error:nil];
    [self.evidence removeObjectForKey:token];
    completion(nil);
  });
}

@end
