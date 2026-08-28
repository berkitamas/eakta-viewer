#import "ES3CapabilityStore.h"

NS_ASSUME_NONNULL_BEGIN

@interface ES3TrustCacheStore : NSObject
- (void)load:(ES3DictionaryCompletion)completion;
- (void)read:(NSString *)token part:(NSString *)part offset:(double)offset length:(double)length completion:(ES3DictionaryCompletion)completion;
- (void)beginWrite:(NSDictionary *)metadata completion:(ES3DictionaryCompletion)completion;
- (void)appendWrite:(NSString *)token part:(NSString *)part sequence:(NSInteger)sequence base64:(NSString *)base64 completion:(ES3VoidCompletion)completion;
- (void)finishWrite:(NSString *)token completion:(ES3VoidCompletion)completion;
@end

NS_ASSUME_NONNULL_END
