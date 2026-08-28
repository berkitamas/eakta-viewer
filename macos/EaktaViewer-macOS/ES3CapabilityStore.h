#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^ES3DictionaryCompletion)(NSDictionary *_Nullable value, NSError *_Nullable error);
typedef void (^ES3VoidCompletion)(NSError *_Nullable error);

@interface ES3CapabilityStore : NSObject
@property(nonatomic, readonly) dispatch_queue_t queue;
- (void)adoptURL:(NSURL *)url completion:(ES3DictionaryCompletion)completion;
- (void)readInput:(NSString *)token offset:(double)offset length:(double)length completion:(ES3DictionaryCompletion)completion;
- (void)beginOutputForSession:(NSString *)sessionId suggestedName:(NSString *)name completion:(ES3DictionaryCompletion)completion;
- (void)appendOutput:(NSString *)token sequence:(NSInteger)sequence base64:(NSString *)base64 completion:(ES3VoidCompletion)completion;
- (void)finishOutput:(NSString *)token completion:(ES3DictionaryCompletion)completion;
- (nullable NSURL *)authorizedOutputURLForPath:(NSString *)path;
- (BOOL)hasSession:(NSString *)sessionId;
- (BOOL)session:(NSString *)sessionId ownsInputToken:(NSString *)inputToken;
- (void)cancelSession:(NSString *)sessionId;
- (void)cleanupSession:(NSString *)sessionId completion:(ES3VoidCompletion)completion;
- (void)storeEvidence:(NSData *)data mimeType:(NSString *)mime sessionId:(NSString *)sessionId completion:(ES3DictionaryCompletion)completion;
- (void)readEvidence:(NSString *)token offset:(double)offset length:(double)length completion:(ES3DictionaryCompletion)completion;
- (void)releaseEvidence:(NSString *)token completion:(ES3VoidCompletion)completion;
@end

NSString *ES3SafeSuggestedName(NSString *name);
NSError *ES3CapabilityError(NSInteger code);
NSURL *_Nullable ES3DroppedFileURL(NSString *value);

NS_ASSUME_NONNULL_END
