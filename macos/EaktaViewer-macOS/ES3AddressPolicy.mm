#import "ES3AddressPolicy.h"
#import "ES3EvidenceBroker.h"
#include <netdb.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <stdio.h>
#include <string.h>

static BOOL ES3IPv4IsPublic(const struct in_addr *address)
{
    uint32_t value = ntohl(address->s_addr);
    uint8_t a = (uint8_t)(value >> 24);
    uint8_t b = (uint8_t)(value >> 16);

    if (a == 0 || a == 10 || a == 127)
        return NO;
    if (a == 100 && b >= 64 && b <= 127)
        return NO;
    if (a == 169 && b == 254)
        return NO;
    if (a == 172 && b >= 16 && b <= 31)
        return NO;
    if (a == 192 && b == 168)
        return NO;
    if (a >= 224)
        return NO;
    return YES;
}

static BOOL ES3IPv6IsPublic(const struct in6_addr *address)
{
    if (IN6_IS_ADDR_UNSPECIFIED(address) ||
        IN6_IS_ADDR_LOOPBACK(address) ||
        IN6_IS_ADDR_LINKLOCAL(address) ||
        IN6_IS_ADDR_MULTICAST(address))
        return NO;

    const uint8_t *bytes = address->s6_addr;
    if ((bytes[0] & 0xfe) == 0xfc)
        return NO;

    if (IN6_IS_ADDR_V4MAPPED(address)) {
        struct in_addr v4;
        memcpy(&v4, bytes + 12, sizeof(v4));
        return ES3IPv4IsPublic(&v4);
    }
    return YES;
}

BOOL ES3ValidateEvidenceURL(NSURL *url,
                            NSString **hostOut,
                            uint16_t *portOut)
{
    if (![url isKindOfClass:[NSURL class]])
        return NO;

    NSURLComponents *components =
        [NSURLComponents componentsWithURL:url.absoluteURL
                   resolvingAgainstBaseURL:NO];
    NSString *scheme = components.scheme.lowercaseString;
    NSString *host = components.host;

    if (!components || !host.length ||
        !([scheme isEqualToString:@"http"] ||
          [scheme isEqualToString:@"https"]) ||
        components.user != nil || components.password != nil ||
        components.fragment != nil)
        return NO;

    NSInteger port = components.port ? components.port.integerValue :
        ([scheme isEqualToString:@"https"] ? 443 : 80);
    if (port < 1 || port > 65535)
        return NO;

    NSCharacterSet *controls = [NSCharacterSet controlCharacterSet];
    if ([host rangeOfCharacterFromSet:controls].location != NSNotFound)
        return NO;

    if (hostOut)
        *hostOut = host;
    if (portOut)
        *portOut = (uint16_t)port;
    return YES;
}

BOOL ES3ResolvePublicHost(NSString *host,
                          uint16_t port,
                          NSString **numericHostOut,
                          NSString **errorOut)
{
    const char *hostName = host.UTF8String;
    if (!hostName) {
        if (errorOut) *errorOut = @"dns";
        return NO;
    }

    char service[8];
    snprintf(service, sizeof(service), "%u", (unsigned)port);

    struct addrinfo hints = {};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_protocol = IPPROTO_TCP;
    hints.ai_flags = AI_NUMERICSERV;

    struct addrinfo *results = NULL;
    int result = getaddrinfo(hostName, service, &hints, &results);
    if (result != 0 || !results) {
        if (errorOut) *errorOut = @"dns";
        if (results) freeaddrinfo(results);
        return NO;
    }

    BOOL found = NO;
    BOOL allPublic = YES;
    NSString *firstNumeric = nil;

    for (struct addrinfo *item = results; item; item = item->ai_next) {
        BOOL isPublic = NO;
        if (item->ai_family == AF_INET) {
            const struct sockaddr_in *sin =
                (const struct sockaddr_in *)item->ai_addr;
            isPublic = ES3IPv4IsPublic(&sin->sin_addr);
        } else if (item->ai_family == AF_INET6) {
            const struct sockaddr_in6 *sin6 =
                (const struct sockaddr_in6 *)item->ai_addr;
            isPublic = ES3IPv6IsPublic(&sin6->sin6_addr);
        } else {
            allPublic = NO;
            break;
        }

        found = YES;
        if (!isPublic) {
            allPublic = NO;
            break;
        }

        if (!firstNumeric) {
            char buffer[NI_MAXHOST];
            int nameResult = getnameinfo(item->ai_addr,
                                         (socklen_t)item->ai_addrlen,
                                         buffer,
                                         sizeof(buffer),
                                         NULL,
                                         0,
                                         NI_NUMERICHOST);
            if (nameResult == 0)
                firstNumeric = [NSString stringWithUTF8String:buffer];
        }
    }

    freeaddrinfo(results);
    if (!found || !allPublic || !firstNumeric.length) {
        if (errorOut) *errorOut = found ? @"blocked_address" : @"dns";
        return NO;
    }

    if (numericHostOut)
        *numericHostOut = firstNumeric;
    return YES;
}

BOOL ES3EndpointIsPublic(NSURL *url)
{
    NSString *host = nil;
    uint16_t port = 0;
    if (!ES3ValidateEvidenceURL(url, &host, &port))
        return NO;
    return ES3ResolvePublicHost(host, port, NULL, NULL);
}
