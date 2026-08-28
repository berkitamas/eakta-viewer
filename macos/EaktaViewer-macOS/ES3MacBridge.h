#import <EaktaViewerSpec/EaktaViewerSpec.h>

NS_ASSUME_NONNULL_BEGIN

@interface ES3MacBridge : NativeES3MacBridgeSpecBase <NativeES3MacBridgeSpec>
+ (void)enqueueFinderURL:(NSURL *)url;
+ (void)sendMenuCommand:(NSString *)command;
@end

NS_ASSUME_NONNULL_END
