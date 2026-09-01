#import "windowOcrCapture.h"

#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Vision/Vision.h>
#import "permissionManager.h"

static const NSUInteger kKronusOcrMaximumCharacters = 7000;
static const NSInteger kKronusOcrMaximumLongEdge = 1600;

@implementation WindowOcrCapture

+ (void)complete:(WindowOcrCaptureCompletion)completion text:(NSString *)text status:(NSString *)status {
    dispatch_async(dispatch_get_main_queue(), ^{
        completion(text, status);
    });
}

+ (BOOL)isEnabledForBundleIdentifier:(NSString *)bundleIdentifier {
    return [bundleIdentifier isEqualToString:@"org.mozilla.firefox"];
}

+ (NSString *)normalizedLine:(NSString *)line {
    NSArray<NSString *> *parts = [line componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    NSMutableArray<NSString *> *nonEmptyParts = [NSMutableArray array];
    for (NSString *part in parts) {
        if (part.length > 0) [nonEmptyParts addObject:part];
    }
    return [nonEmptyParts componentsJoinedByString:@" "];
}

+ (NSString *)recognizedTextFromImage:(CGImageRef)image error:(NSError **)outError {
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:nil];
    request.recognitionLevel = VNRequestTextRecognitionLevelFast;
    request.recognitionLanguages = @[ @"en-US", @"de-DE" ];
    request.usesLanguageCorrection = NO;

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    NSError *error = nil;
    BOOL success = [handler performRequests:@[request] error:&error];
    [handler release];
    if (!success || error) {
        if (outError) *outError = error;
        [request release];
        return nil;
    }

    NSArray<VNRecognizedTextObservation *> *observations = request.results ?: @[];
    observations = [observations sortedArrayUsingComparator:^NSComparisonResult(VNRecognizedTextObservation *left, VNRecognizedTextObservation *right) {
        CGRect leftBox = left.boundingBox;
        CGRect rightBox = right.boundingBox;
        if (fabs(leftBox.origin.y - rightBox.origin.y) > 0.012) {
            return leftBox.origin.y > rightBox.origin.y ? NSOrderedAscending : NSOrderedDescending;
        }
        if (fabs(leftBox.origin.x - rightBox.origin.x) > 0.012) {
            return leftBox.origin.x < rightBox.origin.x ? NSOrderedAscending : NSOrderedDescending;
        }
        return NSOrderedSame;
    }];

    NSMutableString *text = [NSMutableString string];
    for (VNRecognizedTextObservation *observation in observations) {
        VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
        NSString *line = candidate ? [self normalizedLine:candidate.string] : @"";
        if (line.length == 0) continue;
        if (text.length > 0) [text appendString:@"\n"];
        NSUInteger remaining = kKronusOcrMaximumCharacters - text.length;
        if (remaining == 0) break;
        if (line.length > remaining) {
            [text appendString:[line substringToIndex:remaining]];
            break;
        }
        [text appendString:line];
    }
    [request release];
    return text;
}

+ (void)captureTextForWindowId:(CGWindowID)windowId
               bundleIdentifier:(NSString *)bundleIdentifier
                     completion:(WindowOcrCaptureCompletion)completion {
    if (![self isEnabledForBundleIdentifier:bundleIdentifier]) {
        [self complete:completion text:nil status:@"capture_failed"];
        return;
    }
    if ([PermissionManager statusForPermission:PermissionTypeScreenRecording] != PermissionStatusGranted) {
        [self complete:completion text:nil status:@"permission_denied"];
        return;
    }

    [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                                onScreenWindowsOnly:YES
                                                 completionHandler:^(SCShareableContent *content, NSError *contentError) {
        if (contentError || !content) {
            [self complete:completion text:nil status:@"capture_failed"];
            return;
        }

        SCWindow *targetWindow = nil;
        for (SCWindow *window in content.windows) {
            if (window.windowID == windowId) {
                targetWindow = window;
                break;
            }
        }
        if (!targetWindow) {
            [self complete:completion text:nil status:@"capture_failed"];
            return;
        }

        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:targetWindow];
        SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
        CGFloat width = MAX(targetWindow.frame.size.width, 1);
        CGFloat height = MAX(targetWindow.frame.size.height, 1);
        CGFloat scale = MIN(1.0, (CGFloat)kKronusOcrMaximumLongEdge / MAX(width, height));
        configuration.width = MAX(1, (NSInteger)round(width * scale));
        configuration.height = MAX(1, (NSInteger)round(height * scale));

        [SCScreenshotManager captureImageWithFilter:filter configuration:configuration completionHandler:^(CGImageRef image, NSError *captureError) {
            [filter release];
            [configuration release];
            if (captureError || !image) {
                [self complete:completion text:nil status:@"capture_failed"];
                return;
            }

            CGImageRetain(image);
            dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
                NSError *ocrError = nil;
                NSString *text = [self recognizedTextFromImage:image error:&ocrError];
                CGImageRelease(image);
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (ocrError || !text) {
                        completion(nil, @"capture_failed");
                    } else if (text.length == 0) {
                        completion(nil, @"no_text");
                    } else {
                        completion(text, @"captured");
                    }
                });
            });
        }];
    }];
}

@end
