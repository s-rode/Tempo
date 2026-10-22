#pragma once
#include <Cocoa/Cocoa.h>

@interface BrowserTabUtils : NSObject

+ (NSDictionary*)getChromeTabInfo;
+ (NSDictionary*)getSafariTabInfo;

@end 