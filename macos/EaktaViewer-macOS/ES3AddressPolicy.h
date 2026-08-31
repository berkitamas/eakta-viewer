#import <Foundation/Foundation.h>
#include <stdint.h>

NS_ASSUME_NONNULL_BEGIN

/// Performs syntactic URL validation and returns the original URL host and port.
FOUNDATION_EXPORT BOOL ES3ValidateEvidenceURL(
    NSURL *url,
    NSString * _Nullable * _Nullable hostOut,
    uint16_t * _Nullable portOut);

/// Resolves every address for host, rejects the set if any address is non-public,
/// and returns one validated numeric address suitable for endpoint pinning.
FOUNDATION_EXPORT BOOL ES3ResolvePublicHost(
    NSString *host,
    uint16_t port,
    NSString * _Nullable * _Nullable numericHostOut,
    NSString * _Nullable * _Nullable errorOut);

NS_ASSUME_NONNULL_END
