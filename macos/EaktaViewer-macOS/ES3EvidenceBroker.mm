#import "ES3EvidenceBroker.h"

#include <arpa/inet.h>
#include <netdb.h>

static const NSUInteger ES3MaxEvidenceBytes = 10 * 1024 * 1024;

static BOOL ES3IPv4IsPublic(uint32_t networkAddress)
{
  uint32_t host = ntohl(networkAddress);
  uint8_t a = (uint8_t)(host >> 24);
  uint8_t b = (uint8_t)(host >> 16);
  if (a == 0 || a == 10 || a == 127 || a >= 224) return NO;
  if (a == 169 && b == 254) return NO;
  if (a == 172 && b >= 16 && b <= 31) return NO;
  if (a == 192 && b == 168) return NO;
  return YES;
}

static BOOL ES3AddressIsPublic(const struct sockaddr *address)
{
  if (address->sa_family == AF_INET) {
    return ES3IPv4IsPublic(((const struct sockaddr_in *)address)->sin_addr.s_addr);
  }
  if (address->sa_family != AF_INET6) return NO;
  const struct in6_addr *ipv6 = &((const struct sockaddr_in6 *)address)->sin6_addr;
  if (IN6_IS_ADDR_V4MAPPED(ipv6)) {
    uint32_t mapped;
    memcpy(&mapped, &ipv6->s6_addr[12], sizeof(mapped));
    return ES3IPv4IsPublic(mapped);
  }
  const uint8_t *bytes = ipv6->s6_addr;
  BOOL prefixZero = YES;
  for (NSUInteger index = 0; index < 15; index += 1) prefixZero &= bytes[index] == 0;
  if (prefixZero && (bytes[15] == 0 || bytes[15] == 1)) return NO;
  if ((bytes[0] & 0xfe) == 0xfc) return NO;
  if (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80) return NO;
  return bytes[0] != 0xff;
}

BOOL ES3EndpointIsPublic(NSURL *url)
{
  if (!url || url.user.length || url.password.length || url.fragment.length) return NO;
  NSString *scheme = url.scheme.lowercaseString;
  if (!([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"])) return NO;
  NSString *host = url.host;
  if (!host.length || [host.lowercaseString hasSuffix:@".local"]) return NO;
  struct addrinfo hints = {};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  struct addrinfo *results = nullptr;
  if (getaddrinfo(host.UTF8String, nullptr, &hints, &results) != 0 || !results) return NO;
  BOOL allowed = YES;
  for (struct addrinfo *current = results; current; current = current->ai_next) {
    if (!ES3AddressIsPublic(current->ai_addr)) {
      allowed = NO;
      break;
    }
  }
  freeaddrinfo(results);
  return allowed;
}

@interface ES3EvidenceRequest () <NSURLSessionDataDelegate, NSURLSessionTaskDelegate>
@property(nonatomic, copy) ES3EvidenceCompletion completion;
@property(nonatomic, strong) NSMutableData *data;
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic) NSUInteger redirects;
@property(nonatomic, copy) NSString *mimeType;
@end

@implementation ES3EvidenceRequest

- (instancetype)initWithURLRequest:(NSURLRequest *)request
                        completion:(ES3EvidenceCompletion)completion
{
  if ((self = [super init])) {
    _completion = completion;
    _data = [NSMutableData data];
    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.timeoutIntervalForRequest = 10;
    configuration.timeoutIntervalForResource = 10;
    configuration.URLCredentialStorage = nil;
    configuration.URLCache = nil;
    _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
    [[_session dataTaskWithRequest:request] resume];
  }
  return self;
}

- (void)finishWithData:(NSData *)data mime:(NSString *)mime error:(NSString *)error
{
  ES3EvidenceCompletion completion = self.completion;
  self.completion = nil;
  [self.session finishTasksAndInvalidate];
  if (completion) completion(data, mime, error);
}

- (void)cancel
{
  [self.session invalidateAndCancel];
  [self finishWithData:nil mime:nil error:@"cancelled"];
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
 didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler
{
  NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
  NSString *mime = response.MIMEType.lowercaseString ?: @"application/octet-stream";
  NSSet *allowed = [NSSet setWithArray:@[
    @"application/pkix-cert", @"application/pkix-crl", @"application/ocsp-response",
    @"application/pkcs7-mime", @"application/xml", @"text/xml", @"application/octet-stream",
  ]];
  BOOL valid = [http isKindOfClass:NSHTTPURLResponse.class] &&
    http.statusCode >= 200 && http.statusCode < 300 && [allowed containsObject:mime];
  if (!valid) {
    completionHandler(NSURLSessionResponseCancel);
    [self finishWithData:nil mime:nil error:@"response-policy"];
    return;
  }
  self.mimeType = mime;
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data
{
  if (self.data.length + data.length > ES3MaxEvidenceBytes) {
    [dataTask cancel];
    [self finishWithData:nil mime:nil error:@"response-too-large"];
  } else {
    [self.data appendData:data];
  }
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
 willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *_Nullable))completionHandler
{
  self.redirects += 1;
  if (self.redirects > 3 || !ES3EndpointIsPublic(request.URL)) {
    completionHandler(nil);
    [self finishWithData:nil mime:nil error:@"redirect-policy"];
  } else {
    completionHandler(request);
  }
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
 didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge
 completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *_Nullable))completionHandler
{
  if ([challenge.protectionSpace.authenticationMethod isEqualToString:NSURLAuthenticationMethodServerTrust]) {
    completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, nil);
  } else {
    completionHandler(NSURLSessionAuthChallengeCancelAuthenticationChallenge, nil);
  }
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error
{
  if (!self.completion) return;
  if (error) [self finishWithData:nil mime:nil error:@"network-error"];
  else [self finishWithData:self.data mime:self.mimeType error:nil];
}

@end
