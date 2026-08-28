#import "ES3TrustCacheStore.h"

#import <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>

static NSString *ES3TrustSHA256(NSURL *url)
{
  NSFileHandle *handle = [NSFileHandle fileHandleForReadingFromURL:url error:nil];
  if (!handle) return nil;
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  while (true) {
    NSData *data = [handle readDataOfLength:1024 * 1024];
    if (!data.length) break;
    CC_SHA256_Update(&context, data.bytes, (CC_LONG)data.length);
  }
  [handle closeFile];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    [hex appendFormat:@"%02x", digest[index]];
  }
  return hex;
}

@interface ES3TrustCacheStore ()
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *reads;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *writes;
@end

@implementation ES3TrustCacheStore

- (instancetype)init
{
  if ((self = [super init])) {
    _queue = dispatch_queue_create("hu.btj.eaktaviewer.trust-cache", DISPATCH_QUEUE_SERIAL);
    _reads = [NSMutableDictionary dictionary];
    _writes = [NSMutableDictionary dictionary];
  }
  return self;
}

- (NSURL *)applicationDirectory
{
  NSURL *support = [NSFileManager.defaultManager URLForDirectory:NSApplicationSupportDirectory
    inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil];
  NSURL *directory = [support URLByAppendingPathComponent:@"hu.btj.eaktaviewer" isDirectory:YES];
  [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES
                                           attributes:@{NSFilePosixPermissions: @0700} error:nil];
  chmod(directory.fileSystemRepresentation, 0700);
  return directory;
}

- (NSURL *)cacheURL
{
  return [[self applicationDirectory] URLByAppendingPathComponent:@"TrustCache" isDirectory:YES];
}

- (void)load:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSDictionary *(^candidate)(NSURL *, NSURL *, NSURL *) =
      ^NSDictionary *(NSURL *metadataURL, NSURL *lotl, NSURL *hu) {
        NSData *metadataData = metadataURL ? [NSData dataWithContentsOfURL:metadataURL] : nil;
        NSDictionary *metadata = metadataData
          ? [NSJSONSerialization JSONObjectWithData:metadataData options:0 error:nil]
          : nil;
        NSDictionary *lotlAttributes =
          lotl ? [NSFileManager.defaultManager attributesOfItemAtPath:lotl.path error:nil] : nil;
        NSDictionary *huAttributes =
          hu ? [NSFileManager.defaultManager attributesOfItemAtPath:hu.path error:nil] : nil;
        NSArray *stringKeys = @[
          @"verifiedAt", @"lotlNextUpdate", @"huTslNextUpdate", @"lotlSha256", @"huTslSha256"
        ];
        BOOL typed = [metadata isKindOfClass:NSDictionary.class] &&
          [metadata[@"schemaVersion"] isKindOfClass:NSNumber.class] &&
          [metadata[@"schemaVersion"] isEqual:@1] &&
          [metadata[@"lotlSize"] isKindOfClass:NSNumber.class] &&
          [metadata[@"huTslSize"] isKindOfClass:NSNumber.class];
        for (NSString *key in stringKeys) typed &= [metadata[key] isKindOfClass:NSString.class];
        BOOL filesMatch = typed &&
          [lotlAttributes[NSFileSize] isEqualToNumber:metadata[@"lotlSize"]] &&
          [huAttributes[NSFileSize] isEqualToNumber:metadata[@"huTslSize"]] &&
          [ES3TrustSHA256(lotl) isEqualToString:metadata[@"lotlSha256"]] &&
          [ES3TrustSHA256(hu) isEqualToString:metadata[@"huTslSha256"]];
        NSFileHandle *lotlHandle =
          filesMatch ? [NSFileHandle fileHandleForReadingFromURL:lotl error:nil] : nil;
        NSFileHandle *huHandle =
          filesMatch ? [NSFileHandle fileHandleForReadingFromURL:hu error:nil] : nil;
        return lotlHandle && huHandle
          ? @{@"metadata": metadata, @"lotlHandle": lotlHandle, @"huHandle": huHandle,
              @"lotlSize": lotlAttributes[NSFileSize], @"huSize": huAttributes[NSFileSize]}
          : nil;
      };
    NSURL *root = [self cacheURL];
    NSDictionary *selected = candidate(
      [root URLByAppendingPathComponent:@"metadata.json"],
      [root URLByAppendingPathComponent:@"eu-lotl.xml"],
      [root URLByAppendingPathComponent:@"HU_TL.xml"]);
    if (!selected) {
      NSBundle *bundle = NSBundle.mainBundle;
      selected = candidate(
        [bundle URLForResource:@"manifest" withExtension:@"json"],
        [bundle URLForResource:@"eu-lotl" withExtension:@"xml"],
        [bundle URLForResource:@"HU_TL" withExtension:@"xml"]);
    }
    if (!selected) {
      completion(@{@"status": @"missing"}, nil);
      return;
    }
    NSString *token = NSUUID.UUID.UUIDString;
    self.reads[token] = [@{
      @"lotl": [@{@"handle": selected[@"lotlHandle"], @"size": selected[@"lotlSize"],
                   @"nextOffset": @0, @"sequence": @0} mutableCopy],
      @"huTsl": [@{@"handle": selected[@"huHandle"], @"size": selected[@"huSize"],
                    @"nextOffset": @0, @"sequence": @0} mutableCopy],
    } mutableCopy];
    completion(@{@"status": @"available", @"cacheToken": token,
                 @"metadata": selected[@"metadata"]}, nil);
  });
}

- (void)read:(NSString *)token part:(NSString *)part offset:(double)offset length:(double)length completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSMutableDictionary *record = self.reads[token][part];
    if (!record || offset != [record[@"nextOffset"] doubleValue] || length <= 0 || length > 768 * 1024) {
      completion(nil, ES3CapabilityError(20));
      return;
    }
    @try {
      NSFileHandle *handle = record[@"handle"];
      [handle seekToFileOffset:(unsigned long long)offset];
      NSData *data = [handle readDataOfLength:(NSUInteger)length];
      NSNumber *sequence = record[@"sequence"];
      record[@"sequence"] = @([sequence integerValue] + 1);
      record[@"nextOffset"] = @(offset + data.length);
      completion(@{@"dataBase64": [data base64EncodedStringWithOptions:0],
        @"eof": @(data.length == 0 || offset + data.length >= [record[@"size"] doubleValue]),
        @"sequence": sequence}, nil);
    } @catch (NSException *exception) {
      completion(nil, ES3CapabilityError(21));
    }
  });
}

- (void)beginWrite:(NSDictionary *)metadata completion:(ES3DictionaryCompletion)completion
{
  dispatch_async(self.queue, ^{
    if (![metadata[@"schemaVersion"] isEqual:@1]) {
      completion(nil, ES3CapabilityError(22));
      return;
    }
    NSString *token = NSUUID.UUID.UUIDString;
    NSURL *temporary = [[self applicationDirectory]
      URLByAppendingPathComponent:[NSString stringWithFormat:@"TrustCache-%@", token] isDirectory:YES];
    [NSFileManager.defaultManager createDirectoryAtURL:temporary withIntermediateDirectories:NO
                                             attributes:@{NSFilePosixPermissions: @0700} error:nil];
    NSMutableDictionary *record = [@{@"root": temporary, @"metadata": metadata} mutableCopy];
    for (NSString *part in @[@"lotl", @"huTsl"]) {
      NSString *name = [part isEqualToString:@"lotl"] ? @"eu-lotl.xml" : @"HU_TL.xml";
      NSURL *url = [temporary URLByAppendingPathComponent:name];
      [NSFileManager.defaultManager createFileAtPath:url.path contents:nil attributes:@{NSFilePosixPermissions: @0600}];
      record[part] = [@{@"url": url, @"handle": [NSFileHandle fileHandleForWritingToURL:url error:nil],
                         @"sequence": @0} mutableCopy];
    }
    self.writes[token] = record;
    completion(@{@"writeToken": token}, nil);
  });
}

- (void)appendWrite:(NSString *)token part:(NSString *)part sequence:(NSInteger)sequence base64:(NSString *)base64 completion:(ES3VoidCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSMutableDictionary *record = self.writes[token][part];
    if (!record || sequence != [record[@"sequence"] integerValue] ||
        [base64 lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 1024 * 1024) {
      completion(ES3CapabilityError(23));
      return;
    }
    NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
    if (!data) { completion(ES3CapabilityError(24)); return; }
    @try { [(NSFileHandle *)record[@"handle"] writeData:data]; }
    @catch (NSException *exception) { completion(ES3CapabilityError(25)); return; }
    record[@"sequence"] = @(sequence + 1);
    completion(nil);
  });
}

- (void)finishWrite:(NSString *)token completion:(ES3VoidCompletion)completion
{
  dispatch_async(self.queue, ^{
    NSMutableDictionary *record = self.writes[token];
    if (!record) { completion(ES3CapabilityError(26)); return; }
    for (NSString *part in @[@"lotl", @"huTsl"]) [(NSFileHandle *)record[part][@"handle"] closeFile];
    NSDictionary *metadata = record[@"metadata"];
    NSURL *lotl = record[@"lotl"][@"url"];
    NSURL *hu = record[@"huTsl"][@"url"];
    NSDictionary *lotlAttributes = [NSFileManager.defaultManager attributesOfItemAtPath:lotl.path error:nil];
    NSDictionary *huAttributes = [NSFileManager.defaultManager attributesOfItemAtPath:hu.path error:nil];
    BOOL approved = [ES3TrustSHA256(lotl) isEqualToString:metadata[@"lotlSha256"]] &&
      [ES3TrustSHA256(hu) isEqualToString:metadata[@"huTslSha256"]] &&
      [lotlAttributes[NSFileSize] isEqualToNumber:metadata[@"lotlSize"]] &&
      [huAttributes[NSFileSize] isEqualToNumber:metadata[@"huTslSize"]];
    if (!approved) {
      [NSFileManager.defaultManager removeItemAtURL:record[@"root"] error:nil];
      [self.writes removeObjectForKey:token];
      completion(ES3CapabilityError(27));
      return;
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:metadata options:0 error:nil];
    NSURL *metadataURL = [(NSURL *)record[@"root"] URLByAppendingPathComponent:@"metadata.json"];
    [json writeToURL:metadataURL options:NSDataWritingAtomic error:nil];
    chmod(metadataURL.fileSystemRepresentation, 0600);
    NSURL *destination = [self cacheURL];
    NSError *error;
    if ([NSFileManager.defaultManager fileExistsAtPath:destination.path]) {
      [NSFileManager.defaultManager replaceItemAtURL:destination withItemAtURL:record[@"root"]
        backupItemName:nil options:0 resultingItemURL:nil error:&error];
    } else {
      [NSFileManager.defaultManager moveItemAtURL:record[@"root"] toURL:destination error:&error];
    }
    [self.writes removeObjectForKey:token];
    completion(error);
  });
}

@end
