#import "ES3EvidenceBroker.h"
#import "ES3AddressPolicy.h"
#import "ES3HTTPResponseParser.h"
#import <Foundation/Foundation.h>
#import <Network/Network.h>
#import <Security/SecProtocolOptions.h>
#include <string.h>

static BOOL ES3RequestHeaderNameValid(NSString *name)
{
    if (!name.length)
        return NO;

    static const char *separators = "()<>@,;:\\\"/[]?={} \t";
    for (NSUInteger i = 0; i < name.length; ++i) {
        unichar c = [name characterAtIndex:i];
        if (c < 33 || c > 126 || strchr(separators, (int)c))
            return NO;
    }
    return YES;
}

static BOOL ES3RequestHeaderValueValid(NSString *value)
{
    for (NSUInteger i = 0; i < value.length; ++i) {
        unichar c = [value characterAtIndex:i];
        if (c == '\r' || c == '\n' || c == 0 || c > 127)
            return NO;
    }
    return YES;
}

static NSData *ES3DataFromDispatchData(dispatch_data_t data)
{
    if (!data)
        return [NSData data];

    NSMutableData *result =
        [NSMutableData dataWithCapacity:dispatch_data_get_size(data)];
    dispatch_data_apply(data, ^bool(dispatch_data_t region,
                                    size_t offset,
                                    const void *buffer,
                                    size_t size) {
        (void)region;
        (void)offset;
        [result appendBytes:buffer length:size];
        return true;
    });
    return result;
}

@interface ES3EvidenceRequest () {
    dispatch_queue_t _queue;
    nw_connection_t _connection;
    void (^_completion)(NSData *, NSString *, NSString *);
    NSDictionary<NSString *, NSString *> *_requestHeaders;

    NSURL *_url;
    NSString *_method;
    NSData *_requestBody;
    ES3HTTPResponseParser *_parser;

    NSUInteger _redirects;
    NSUInteger _token;
    BOOL _finished;
}
@end

@implementation ES3EvidenceRequest

- (instancetype)initWithURLRequest:(NSURLRequest *)request
                        completion:(void (^)(NSData *, NSString *, NSString *))completion
{
    self = [super init];
    if (self) {
        _queue = dispatch_queue_create("com.es3.evidence-broker",
                                       DISPATCH_QUEUE_SERIAL);
        _completion = [completion copy];
        _requestHeaders = [request.allHTTPHeaderFields copy] ?: @{};

        NSURL *url = [request.URL copy];
        NSString *method = (request.HTTPMethod ?: @"GET").uppercaseString;
        NSData *body = [request.HTTPBody copy];
        BOOL hasBodyStream = request.HTTPBodyStream != nil;

        __weak __typeof__(self) weakSelf = self;
        dispatch_async(_queue, ^{
            __typeof__(self) self = weakSelf;
            if (!self)
                return;
            if (!([method isEqualToString:@"GET"] ||
                  [method isEqualToString:@"POST"])) {
                [self finishData:nil mime:nil error:@"unsupported_method"];
                return;
            }
            if (!body && hasBodyStream) {
                [self finishData:nil mime:nil error:@"unsupported_body"];
                return;
            }
            if (body.length > ES3HTTPMaximumBodyBytes) {
                [self finishData:nil mime:nil error:@"body_too_large"];
                return;
            }
            [self beginHop:url method:method body:body redirects:0];
        });

        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC),
                       _queue, ^{
            __typeof__(self) self = weakSelf;
            if (self && !self->_finished)
                [self finishData:nil mime:nil error:@"timeout"];
        });
    }
    return self;
}

- (void)cancel
{
    __weak __typeof__(self) weakSelf = self;
    dispatch_async(_queue, ^{
        __typeof__(self) self = weakSelf;
        if (self && !self->_finished)
            [self finishData:nil mime:nil error:@"cancelled"];
    });
}

- (void)dealloc
{
    if (_connection)
        nw_connection_cancel(_connection);
}

- (void)finishData:(NSData *)data mime:(NSString *)mime error:(NSString *)error
{
    if (_finished)
        return;

    _finished = YES;
    ++_token;
    if (_connection) {
        nw_connection_cancel(_connection);
        _connection = nil;
    }

    void (^completion)(NSData *, NSString *, NSString *) = _completion;
    _completion = nil;
    if (completion) {
        NSData *resultData = [data copy];
        NSString *resultMIME = [mime copy];
        NSString *resultError = [error copy];
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(resultData, resultMIME, resultError);
        });
    }
}

- (void)beginHop:(NSURL *)url
          method:(NSString *)method
            body:(NSData *)body
       redirects:(NSUInteger)redirects
{
    NSString *host = nil;
    uint16_t port = 0;
    if (!ES3ValidateEvidenceURL(url, &host, &port)) {
        [self finishData:nil mime:nil error:@"invalid_url"];
        return;
    }

    NSUInteger token = ++_token;
    if (_connection) {
        nw_connection_cancel(_connection);
        _connection = nil;
    }

    _url = url.absoluteURL;
    _method = [method copy];
    _requestBody = [body copy];
    _redirects = redirects;
    _parser = [[ES3HTTPResponseParser alloc] init];

    dispatch_queue_t callbackQueue = _queue;
    __weak __typeof__(self) weakSelf = self;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSString *numeric = nil;
        NSString *resolutionError = nil;
        BOOL ok = ES3ResolvePublicHost(host, port, &numeric, &resolutionError);

        dispatch_async(callbackQueue, ^{
            __typeof__(self) self = weakSelf;
            if (!self || self->_finished || self->_token != token)
                return;
            if (!ok) {
                [self finishData:nil
                           mime:nil
                          error:resolutionError ?: @"dns"];
                return;
            }
            [self connectToNumericHost:numeric
                                  port:port
                               tlsHost:host
                                 token:token];
        });
    });
}

- (void)connectToNumericHost:(NSString *)numeric
                        port:(uint16_t)port
                     tlsHost:(NSString *)tlsHost
                       token:(NSUInteger)token
{
    nw_parameters_t parameters;
    if ([_url.scheme.lowercaseString isEqualToString:@"https"]) {
        NSString *serverName = [tlsHost copy];
        parameters = nw_parameters_create_secure_tcp(
            ^(nw_protocol_options_t tlsOptions) {
                sec_protocol_options_t options =
                    nw_tls_copy_sec_protocol_options(tlsOptions);
                // This sets SNI to the original host. No verify block is installed,
                // so Network.framework retains default hostname/trust validation.
                sec_protocol_options_set_tls_server_name(options,
                                                          serverName.UTF8String);
            },
            NW_PARAMETERS_DEFAULT_CONFIGURATION);
    } else {
        parameters = nw_parameters_create_secure_tcp(
            NW_PARAMETERS_DISABLE_PROTOCOL,
            NW_PARAMETERS_DEFAULT_CONFIGURATION);
    }

    nw_parameters_set_prefer_no_proxy(parameters, true);
    NSString *service = [NSString stringWithFormat:@"%u", (unsigned)port];
    nw_endpoint_t endpoint =
        nw_endpoint_create_host(numeric.UTF8String, service.UTF8String);
    nw_connection_t connection = nw_connection_create(endpoint, parameters);
    _connection = connection;
    nw_connection_set_queue(connection, _queue);

    __weak __typeof__(self) weakSelf = self;
    nw_connection_set_state_changed_handler(connection,
        ^(nw_connection_state_t state, nw_error_t error) {
        (void)error;
        __typeof__(self) self = weakSelf;
        if (!self || self->_finished || self->_token != token)
            return;
        if (state == nw_connection_state_ready)
            [self sendRequestForToken:token];
        else if (state == nw_connection_state_failed)
            [self finishData:nil mime:nil error:@"network"];
    });
    nw_connection_start(connection);
}

- (NSData *)serializedRequest
{
    NSURLComponents *components =
        [NSURLComponents componentsWithURL:_url resolvingAgainstBaseURL:NO];
    NSString *path = components.percentEncodedPath;
    if (!path.length)
        path = @"/";
    if (components.percentEncodedQuery != nil)
        path = [path stringByAppendingFormat:@"?%@", components.percentEncodedQuery];

    NSString *host = components.host;
    if ([host containsString:@":"] && ![host hasPrefix:@"["])
        host = [NSString stringWithFormat:@"[%@]", host];

    NSInteger defaultPort =
        [components.scheme.lowercaseString isEqualToString:@"https"] ? 443 : 80;
    if (components.port && components.port.integerValue != defaultPort)
        host = [host stringByAppendingFormat:@":%@", components.port];

    NSMutableString *request =
        [NSMutableString stringWithFormat:@"%@ %@ HTTP/1.1\r\n", _method, path];
    [request appendFormat:@"Host: %@\r\n", host];
    [request appendString:@"Connection: close\r\n"];
    [request appendString:@"Accept-Encoding: identity\r\n"];

    NSSet<NSString *> *excluded = [NSSet setWithObjects:
        @"host", @"connection", @"accept-encoding", @"content-length",
        @"transfer-encoding", @"authorization", @"proxy-authorization",
        @"cookie", @"proxy-connection", @"upgrade", @"expect", @"te",
        @"trailer", nil];

    [_requestHeaders enumerateKeysAndObjectsUsingBlock:
        ^(NSString *name, NSString *value, BOOL *stop) {
        (void)stop;
        if (![name isKindOfClass:[NSString class]] ||
            ![value isKindOfClass:[NSString class]])
            return;
        NSString *lower = name.lowercaseString;
        if ([excluded containsObject:lower])
            return;
        if ([_method isEqualToString:@"GET"] &&
            ([lower isEqualToString:@"content-type"] ||
             [lower isEqualToString:@"content-encoding"]))
            return;
        if (ES3RequestHeaderNameValid(name) &&
            ES3RequestHeaderValueValid(value))
            [request appendFormat:@"%@: %@\r\n", name, value];
    }];

    if ([_method isEqualToString:@"POST"])
        [request appendFormat:@"Content-Length: %llu\r\n",
            (unsigned long long)_requestBody.length];

    [request appendString:@"\r\n"];
    NSMutableData *data =
        [[request dataUsingEncoding:NSASCIIStringEncoding] mutableCopy];
    if (!data)
        return nil;
    if (_requestBody.length)
        [data appendData:_requestBody];
    return data;
}

- (void)sendRequestForToken:(NSUInteger)token
{
    NSData *request = [self serializedRequest];
    if (!request) {
        [self finishData:nil mime:nil error:@"invalid_request"];
        return;
    }

    dispatch_data_t content =
        dispatch_data_create(request.bytes, request.length, _queue,
                             ^{ (void)request; });
    __weak __typeof__(self) weakSelf = self;
    nw_connection_send(_connection,
                       content,
                       NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT,
                       true,
                       ^(nw_error_t error) {
        (void)request;
        __typeof__(self) self = weakSelf;
        if (!self || self->_finished || self->_token != token)
            return;
        if (error) {
            [self finishData:nil mime:nil error:@"network"];
            return;
        }
        [self receiveForToken:token];
    });
}

- (void)receiveForToken:(NSUInteger)token
{
    __weak __typeof__(self) weakSelf = self;
    nw_connection_receive(_connection, 1, 64 * 1024,
        ^(dispatch_data_t content, nw_content_context_t context,
          bool complete, nw_error_t error) {
        (void)context;
        __typeof__(self) self = weakSelf;
        if (!self || self->_finished || self->_token != token)
            return;

        if (content) {
            [self->_parser appendData:ES3DataFromDispatchData(content)];
            [self consumeParserResultForToken:token];
            if (self->_finished || self->_token != token)
                return;
        }
        if (error) {
            [self finishData:nil mime:nil error:@"network"];
            return;
        }
        if (complete) {
            [self->_parser finishAtEOF];
            [self consumeParserResultForToken:token];
            return;
        }
        [self receiveForToken:token];
    });
}

- (void)consumeParserResultForToken:(NSUInteger)token
{
    if (_finished || _token != token)
        return;

    switch (_parser.state) {
        case ES3HTTPResponseParserStateAwaitingData:
            return;
        case ES3HTTPResponseParserStateComplete:
            [self finishData:_parser.responseBody
                        mime:_parser.MIMEType
                       error:nil];
            return;
        case ES3HTTPResponseParserStateFailed:
            [self finishData:nil
                        mime:nil
                       error:_parser.errorCode ?: @"protocol"];
            return;
        case ES3HTTPResponseParserStateRedirect:
            [self followRedirect];
            return;
    }
}

- (void)followRedirect
{
    NSString *location = _parser.redirectLocation;
    if (!location.length || _redirects >= 3) {
        [self finishData:nil mime:nil error:@"redirect"];
        return;
    }

    NSURL *redirectURL =
        [[NSURL URLWithString:location relativeToURL:_url] absoluteURL];
    NSString *newMethod = _method;
    NSData *newBody = _requestBody;
    NSInteger status = _parser.statusCode;
    if (status == 303 ||
        ((status == 301 || status == 302) &&
         [_method isEqualToString:@"POST"])) {
        newMethod = @"GET";
        newBody = nil;
    }

    // beginHop revalidates syntax and resolves/rechecks every redirect address.
    [self beginHop:redirectURL
            method:newMethod
              body:newBody
         redirects:_redirects + 1];
}

@end
