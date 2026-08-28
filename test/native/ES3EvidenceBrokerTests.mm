#import <Foundation/Foundation.h>
#import "../../macos/EaktaViewer-macOS/ES3EvidenceBroker.h"
#import "../../macos/EaktaViewer-macOS/ES3CapabilityStore.h"

static void requireRejected(NSString *value)
{
  if (ES3EndpointIsPublic([NSURL URLWithString:value])) {
    @throw [NSException exceptionWithName:@"PolicyFailure" reason:@"A private endpoint was accepted." userInfo:nil];
  }
}

int main(void)
{
  @autoreleasepool {
    requireRejected(@"http://127.0.0.1/");
    requireRejected(@"http://10.0.0.1/");
    requireRejected(@"http://192.168.1.1/");
    requireRejected(@"http://[::1]/");
    requireRejected(@"http://[::ffff:127.0.0.1]/");
    requireRejected(@"http://[::ffff:10.0.0.1]/");
    requireRejected(@"http://device.local/");
    if (!ES3DroppedFileURL(@"/tmp/synthetic.es3").isFileURL) return 3;
    if (!ES3DroppedFileURL(@"file:///tmp/synthetic.es3").isFileURL) return 4;
    if (ES3DroppedFileURL(@"https://example.invalid/synthetic.es3")) return 5;
    if (ES3DroppedFileURL(@"relative.es3")) return 6;
    if (ES3DroppedFileURL(@"file://server.example/tmp/synthetic.es3")) return 7;
    if (!ES3EndpointIsPublic([NSURL URLWithString:@"https://[2606:4700:4700::1111]/"])) return 2;
  }
  return 0;
}
