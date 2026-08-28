#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^ES3EvidenceCompletion)(NSData *_Nullable data,
                                      NSString *_Nullable mimeType,
                                      NSString *_Nullable errorCode);

BOOL ES3EndpointIsPublic(NSURL *url);

@interface ES3EvidenceRequest : NSObject
- (instancetype)initWithURLRequest:(NSURLRequest *)request
                        completion:(ES3EvidenceCompletion)completion;
- (void)cancel;
@end

NS_ASSUME_NONNULL_END
