#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT const NSUInteger ES3HTTPMaximumBodyBytes;
FOUNDATION_EXPORT const NSUInteger ES3HTTPMaximumHeaderBytes;

typedef NS_ENUM(NSUInteger, ES3HTTPResponseParserState) {
    ES3HTTPResponseParserStateAwaitingData = 0,
    ES3HTTPResponseParserStateComplete,
    ES3HTTPResponseParserStateRedirect,
    ES3HTTPResponseParserStateFailed,
};

@interface ES3HTTPResponseParser : NSObject

@property(nonatomic, readonly) ES3HTTPResponseParserState state;
@property(nonatomic, readonly) NSInteger statusCode;
@property(nonatomic, copy, readonly)
    NSDictionary<NSString *, NSArray<NSString *> *> *responseHeaders;
@property(nonatomic, copy, readonly, nullable) NSString *MIMEType;
@property(nonatomic, copy, readonly, nullable) NSData *responseBody;
@property(nonatomic, copy, readonly, nullable) NSString *redirectLocation;
@property(nonatomic, copy, readonly, nullable) NSString *errorCode;

- (void)appendData:(NSData *)data;
- (void)finishAtEOF;

@end

NS_ASSUME_NONNULL_END
