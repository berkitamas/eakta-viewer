#import <Foundation/Foundation.h>
#import "../../macos/EaktaViewer-macOS/ES3EvidenceBroker.h"
#import "../../macos/EaktaViewer-macOS/ES3CapabilityStore.h"
#import "../../macos/EaktaViewer-macOS/ES3HTTPResponseParser.h"

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
    ES3HTTPResponseParser *fixed = [ES3HTTPResponseParser new];
    [fixed appendData:[@"HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nContent-Length: 4\r\n\r\ntest"
      dataUsingEncoding:NSASCIIStringEncoding]];
    if (fixed.state != ES3HTTPResponseParserStateComplete ||
        fixed.responseBody.length != 4) return 8;
    ES3HTTPResponseParser *chunked = [ES3HTTPResponseParser new];
    [chunked appendData:[@"HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ntest\r\n0\r\n\r\n"
      dataUsingEncoding:NSASCIIStringEncoding]];
    if (chunked.state != ES3HTTPResponseParserStateComplete ||
        chunked.responseBody.length != 4) return 9;
    ES3HTTPResponseParser *redirect = [ES3HTTPResponseParser new];
    [redirect appendData:[@"HTTP/1.1 302 Found\r\nLocation: https://example.com/next\r\nContent-Length: 0\r\n\r\n"
      dataUsingEncoding:NSASCIIStringEncoding]];
    if (redirect.state != ES3HTTPResponseParserStateRedirect ||
        ![redirect.redirectLocation isEqualToString:@"https://example.com/next"]) return 10;
    if (!ES3EndpointIsPublic([NSURL URLWithString:@"https://8.8.8.8/"])) return 2;
  }
  return 0;
}
