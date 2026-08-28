#import "ES3HTTPResponseParser.h"
#include <errno.h>
#include <stdlib.h>

const NSUInteger ES3HTTPMaximumBodyBytes = 10 * 1024 * 1024;
const NSUInteger ES3HTTPMaximumHeaderBytes = 64 * 1024;

static BOOL ES3HTTPHeaderNameValid(NSString *name)
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

static NSString *ES3HTTPNormalizedMIME(NSString *value)
{
    NSString *type = [[[value componentsSeparatedByString:@";"] firstObject]
        stringByTrimmingCharactersInSet:
            [NSCharacterSet whitespaceAndNewlineCharacterSet]];
    type = type.lowercaseString;

    static NSSet<NSString *> *allowed;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        allowed = [NSSet setWithObjects:
            @"application/pkix-cert",
            @"application/pkix-crl",
            @"application/ocsp-response",
            @"application/pkcs7-mime",
            @"application/xml",
            @"text/xml",
            @"application/octet-stream",
            nil];
    });
    return [allowed containsObject:type] ? type : nil;
}

@interface ES3HTTPResponseParser () {
    NSMutableData *_input;
    NSMutableData *_body;
    NSUInteger _headerBytes;
    long long _contentLength;
    BOOL _headersDone;
    BOOL _chunked;
    NSUInteger _chunkState;
    uint64_t _chunkRemaining;
}
@property(nonatomic) ES3HTTPResponseParserState state;
@property(nonatomic) NSInteger statusCode;
@property(nonatomic, copy)
    NSDictionary<NSString *, NSArray<NSString *> *> *responseHeaders;
@property(nonatomic, copy, nullable) NSString *MIMEType;
@property(nonatomic, copy, nullable) NSData *responseBody;
@property(nonatomic, copy, nullable) NSString *redirectLocation;
@property(nonatomic, copy, nullable) NSString *errorCode;
@end

@implementation ES3HTTPResponseParser

- (instancetype)init
{
    self = [super init];
    if (self) {
        _input = [NSMutableData data];
        _body = [NSMutableData data];
        _responseHeaders = @{};
        _contentLength = -1;
        _state = ES3HTTPResponseParserStateAwaitingData;
    }
    return self;
}

- (void)fail:(NSString *)error
{
    if (_state != ES3HTTPResponseParserStateAwaitingData)
        return;
    self.errorCode = error;
    self.state = ES3HTTPResponseParserStateFailed;
    [_input setLength:0];
}

- (void)complete
{
    if (_state != ES3HTTPResponseParserStateAwaitingData)
        return;
    self.responseBody = [_body copy];
    self.state = ES3HTTPResponseParserStateComplete;
    [_input setLength:0];
}

- (void)appendData:(NSData *)data
{
    const uint8_t *bytes = (const uint8_t *)data.bytes;
    NSUInteger offset = 0;
    while (offset < data.length &&
           _state == ES3HTTPResponseParserStateAwaitingData) {
        NSUInteger amount = MIN((NSUInteger)(64 * 1024), data.length - offset);
        [_input appendBytes:bytes + offset length:amount];
        offset += amount;
        [self processInput];
    }
}

- (void)processInput
{
    while (_state == ES3HTTPResponseParserStateAwaitingData) {
        if (!_headersDone) {
            static NSData *delimiter;
            static dispatch_once_t once;
            dispatch_once(&once, ^{
                delimiter = [@"\r\n\r\n" dataUsingEncoding:NSASCIIStringEncoding];
            });
            NSRange range = [_input rangeOfData:delimiter
                                       options:0
                                         range:NSMakeRange(0, _input.length)];
            if (range.location == NSNotFound) {
                if (_headerBytes + _input.length > ES3HTTPMaximumHeaderBytes)
                    [self fail:@"headers_too_large"];
                return;
            }

            NSUInteger consumed = NSMaxRange(range);
            _headerBytes += consumed;
            if (_headerBytes > ES3HTTPMaximumHeaderBytes) {
                [self fail:@"headers_too_large"];
                return;
            }

            NSData *block = [_input subdataWithRange:
                NSMakeRange(0, consumed - delimiter.length)];
            [_input replaceBytesInRange:NSMakeRange(0, consumed)
                              withBytes:NULL
                                 length:0];
            if (![self parseHeaderBlock:block])
                return;
            if (!_headersDone)
                continue;
        }

        if (_chunked) {
            [self processChunked];
            return;
        }

        if (_contentLength >= 0) {
            NSUInteger needed = (NSUInteger)_contentLength - _body.length;
            NSUInteger amount = MIN(needed, _input.length);
            if (amount) {
                [_body appendBytes:_input.bytes length:amount];
                [_input replaceBytesInRange:NSMakeRange(0, amount)
                                  withBytes:NULL
                                     length:0];
            }
            if (_body.length == (NSUInteger)_contentLength)
                [self complete];
            return;
        }

        if (_input.length) {
            if (_body.length + _input.length > ES3HTTPMaximumBodyBytes) {
                [self fail:@"body_too_large"];
                return;
            }
            [_body appendData:_input];
            [_input setLength:0];
        }
        return;
    }
}

- (BOOL)parseHeaderBlock:(NSData *)data
{
    NSString *text = [[NSString alloc] initWithData:data
                                           encoding:NSISOLatin1StringEncoding];
    NSArray<NSString *> *lines = [text componentsSeparatedByString:@"\r\n"];
    if (!text || !lines.count || ![lines[0] hasPrefix:@"HTTP/1."]) {
        [self fail:@"protocol"];
        return NO;
    }

    NSArray<NSString *> *parts = [lines[0]
        componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    NSMutableArray<NSString *> *tokens = [NSMutableArray array];
    for (NSString *part in parts)
        if (part.length) [tokens addObject:part];
    if (tokens.count < 2 || tokens[1].length != 3) {
        [self fail:@"protocol"];
        return NO;
    }

    NSInteger status = tokens[1].integerValue;
    if (status < 100 || status > 999) {
        [self fail:@"protocol"];
        return NO;
    }

    NSString *contentType = nil;
    NSString *transferEncoding = nil;
    NSString *contentLengthValue = nil;
    NSString *location = nil;
    NSMutableDictionary<NSString *, NSMutableArray<NSString *> *> *headers =
        [NSMutableDictionary dictionary];

    for (NSUInteger i = 1; i < lines.count; ++i) {
        NSString *line = lines[i];
        if (!line.length)
            continue;
        if ([line hasPrefix:@" "] || [line hasPrefix:@"\t"]) {
            [self fail:@"protocol"];
            return NO;
        }

        NSRange colon = [line rangeOfString:@":"];
        if (colon.location == NSNotFound) {
            [self fail:@"protocol"];
            return NO;
        }

        NSString *name = [[line substringToIndex:colon.location] lowercaseString];
        NSString *value = [[line substringFromIndex:colon.location + 1]
            stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if (!ES3HTTPHeaderNameValid(name)) {
            [self fail:@"protocol"];
            return NO;
        }

        NSMutableArray<NSString *> *values = headers[name];
        if (!values) {
            values = [NSMutableArray array];
            headers[name] = values;
        }
        [values addObject:value];

        if ([name isEqualToString:@"content-type"]) {
            if (contentType) {
                [self fail:@"protocol"];
                return NO;
            }
            contentType = value;
        } else if ([name isEqualToString:@"content-length"]) {
            if (contentLengthValue && ![contentLengthValue isEqualToString:value]) {
                [self fail:@"protocol"];
                return NO;
            }
            contentLengthValue = value;
        } else if ([name isEqualToString:@"transfer-encoding"]) {
            transferEncoding = transferEncoding ?
                [transferEncoding stringByAppendingFormat:@",%@", value] : value;
        } else if ([name isEqualToString:@"location"]) {
            if (location) {
                [self fail:@"protocol"];
                return NO;
            }
            location = value;
        }
    }

    NSMutableDictionary *frozen = [NSMutableDictionary dictionary];
    [headers enumerateKeysAndObjectsUsingBlock:
        ^(NSString *key, NSMutableArray<NSString *> *values, BOOL *stop) {
        (void)stop;
        frozen[key] = [values copy];
    }];
    self.statusCode = status;
    self.responseHeaders = [frozen copy];

    if (status >= 100 && status < 200 && status != 101)
        return YES;

    if (status == 301 || status == 302 || status == 303 ||
        status == 307 || status == 308) {
        if (!location.length) {
            [self fail:@"redirect"];
            return NO;
        }
        self.redirectLocation = location;
        self.state = ES3HTTPResponseParserStateRedirect;
        [_input setLength:0];
        return NO;
    }

    if (status < 200 || status >= 300) {
        [self fail:@"http_status"];
        return NO;
    }

    self.MIMEType = ES3HTTPNormalizedMIME(contentType);
    if (!self.MIMEType) {
        [self fail:@"mime_type"];
        return NO;
    }

    if (contentLengthValue) {
        if (!contentLengthValue.length) {
            [self fail:@"protocol"];
            return NO;
        }
        const char *s = contentLengthValue.UTF8String;
        char *end = NULL;
        errno = 0;
        unsigned long long value = strtoull(s, &end, 10);
        if (errno || end == s || *end != '\0' ||
            value > ES3HTTPMaximumBodyBytes) {
            [self fail:(value > ES3HTTPMaximumBodyBytes ?
                        @"body_too_large" : @"protocol")];
            return NO;
        }
        _contentLength = (long long)value;
    }

    if (transferEncoding.length) {
        NSString *encoding = [transferEncoding.lowercaseString
            stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if (![encoding isEqualToString:@"chunked"] || contentLengthValue) {
            [self fail:@"protocol"];
            return NO;
        }
        _chunked = YES;
    }

    _headersDone = YES;
    if (_contentLength == 0) {
        [self complete];
        return NO;
    }
    return YES;
}

- (void)processChunked
{
    while (_state == ES3HTTPResponseParserStateAwaitingData) {
        if (_chunkState == 0) {
            static NSData *crlf;
            static dispatch_once_t once;
            dispatch_once(&once, ^{
                crlf = [@"\r\n" dataUsingEncoding:NSASCIIStringEncoding];
            });
            NSRange range = [_input rangeOfData:crlf
                                       options:0
                                         range:NSMakeRange(0, _input.length)];
            if (range.location == NSNotFound) {
                if (_input.length > ES3HTTPMaximumHeaderBytes)
                    [self fail:@"protocol"];
                return;
            }

            NSData *lineData = [_input subdataWithRange:NSMakeRange(0, range.location)];
            NSString *line = [[NSString alloc] initWithData:lineData
                                                   encoding:NSASCIIStringEncoding];
            NSString *sizeText = [[line componentsSeparatedByString:@";"] firstObject];
            sizeText = [sizeText stringByTrimmingCharactersInSet:
                [NSCharacterSet whitespaceCharacterSet]];
            const char *s = sizeText.UTF8String;
            char *end = NULL;
            errno = 0;
            unsigned long long size = strtoull(s, &end, 16);
            if (!line || !sizeText.length || errno || end == s || *end != '\0') {
                [self fail:@"protocol"];
                return;
            }

            [_input replaceBytesInRange:NSMakeRange(0, NSMaxRange(range))
                              withBytes:NULL
                                 length:0];
            _chunkRemaining = size;
            _chunkState = size ? 1 : 3;
        } else if (_chunkState == 1) {
            NSUInteger amount = (NSUInteger)MIN((uint64_t)_input.length,
                                                 _chunkRemaining);
            if (!amount)
                return;
            if (_body.length + amount > ES3HTTPMaximumBodyBytes) {
                [self fail:@"body_too_large"];
                return;
            }
            [_body appendBytes:_input.bytes length:amount];
            [_input replaceBytesInRange:NSMakeRange(0, amount)
                              withBytes:NULL
                                 length:0];
            _chunkRemaining -= amount;
            if (_chunkRemaining == 0)
                _chunkState = 2;
        } else if (_chunkState == 2) {
            if (_input.length < 2)
                return;
            const uint8_t *bytes = (const uint8_t *)_input.bytes;
            if (bytes[0] != '\r' || bytes[1] != '\n') {
                [self fail:@"protocol"];
                return;
            }
            [_input replaceBytesInRange:NSMakeRange(0, 2)
                              withBytes:NULL
                                 length:0];
            _chunkState = 0;
        } else {
            if (_input.length >= 2) {
                const uint8_t *bytes = (const uint8_t *)_input.bytes;
                if (bytes[0] == '\r' && bytes[1] == '\n') {
                    if (_headerBytes + 2 > ES3HTTPMaximumHeaderBytes)
                        [self fail:@"headers_too_large"];
                    else
                        [self complete];
                    return;
                }
            }

            static NSData *delimiter;
            static dispatch_once_t once;
            dispatch_once(&once, ^{
                delimiter = [@"\r\n\r\n" dataUsingEncoding:NSASCIIStringEncoding];
            });
            NSRange range = [_input rangeOfData:delimiter
                                       options:0
                                         range:NSMakeRange(0, _input.length)];
            if (range.location != NSNotFound) {
                if (_headerBytes + NSMaxRange(range) > ES3HTTPMaximumHeaderBytes)
                    [self fail:@"headers_too_large"];
                else
                    [self complete];
                return;
            }
            if (_headerBytes + _input.length > ES3HTTPMaximumHeaderBytes)
                [self fail:@"headers_too_large"];
            return;
        }
    }
}

- (void)finishAtEOF
{
    if (_state != ES3HTTPResponseParserStateAwaitingData)
        return;
    if (!_headersDone) {
        [self fail:@"protocol"];
        return;
    }
    if (_chunked || (_contentLength >= 0 &&
                     _body.length != (NSUInteger)_contentLength)) {
        [self fail:@"protocol"];
        return;
    }
    if (_contentLength < 0)
        [self complete];
}

@end
