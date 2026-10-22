#import <Cocoa/Cocoa.h>
#import <napi.h>
#import "./activeWindowObserver.h"
#import "./permissionManager.h"
#import "./iconUtils.h"
#include "reminders.h"

void StartActiveWindowObserverMethod(const Napi::CallbackInfo& info) {
  initActiveWindowObserver(info.Env(), info[0].As<Napi::Function>());
}

void StopActiveWindowObserverMethod(const Napi::CallbackInfo& info) {
  stopActiveWindowObserver(info.Env());
}

void SetActivityCapturePausedMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    Napi::TypeError::New(env, "Expected boolean argument").ThrowAsJavaScriptException();
    return;
  }
  setActivityCapturePaused(info[0].As<Napi::Boolean>().Value());
}

Napi::Value RefreshActiveWindowMethod(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), refreshActiveWindow());
}

Napi::Value ResumeAfterSystemSuspensionMethod(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), resumeAfterSystemSuspension());
}

// Resolves a local macOS application icon. Only an app name and a generated
// cache path cross this boundary—never a window title, URL, or page content.
Napi::Value GetAppIconPathMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected application name").ThrowAsJavaScriptException();
    return env.Null();
  }
  NSString *appName = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  NSString *iconPath = getAppIconPath(appName);
  return iconPath ? Napi::String::New(env, [iconPath UTF8String]) : env.Null();
}

static NSDictionary *DictionaryFromJsonArgument(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsString()) return nil;
  NSString *json = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}

void SetFirefoxNavigationStateMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSDictionary *state = DictionaryFromJsonArgument(info);
  if (!state) {
    Napi::TypeError::New(env, "Expected navigation JSON string").ThrowAsJavaScriptException();
    return;
  }
  setFirefoxNavigationState(state);
}

void CaptureFirefoxNavigationMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSDictionary *state = DictionaryFromJsonArgument(info);
  NSNumber *windowId = state[@"windowId"];
  NSString *title = state[@"title"];
  NSString *fingerprint = state[@"navigationFingerprint"];
  if (!windowId || !title || !fingerprint) {
    Napi::TypeError::New(env, "Expected Firefox navigation identity").ThrowAsJavaScriptException();
    return;
  }
  captureFirefoxNavigation(windowId, title, fingerprint);
}

void SetFirefoxCompanionConnectedMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    Napi::TypeError::New(env, "Expected Firefox companion connection state").ThrowAsJavaScriptException();
    return;
  }
  setFirefoxCompanionConnected(info[0].As<Napi::Boolean>().Value());
}

void SetShouldRequestPermissionsMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    Napi::TypeError::New(env, "Expected boolean argument").ThrowAsJavaScriptException();
    return;
  }
  [PermissionManager setShouldRequestPermissions:info[0].As<Napi::Boolean>().Value()];
}

Napi::Value GetShouldRequestPermissionsMethod(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), [PermissionManager shouldRequestPermissions]);
}

Napi::Value GetPermissionStatusMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected number argument for permission type").ThrowAsJavaScriptException();
    return env.Null();
  }
  PermissionStatus status = [PermissionManager statusForPermission:(PermissionType)info[0].As<Napi::Number>().Int32Value()];
  return Napi::Number::New(env, (int)status);
}

Napi::Value HasPermissionsForTitleExtractionMethod(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), [PermissionManager hasPermissionsForTitleExtraction]);
}

Napi::Value HasPermissionsForContentExtractionMethod(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), [PermissionManager hasPermissionsForContentExtraction]);
}

void RequestPermissionMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected number argument for permission type").ThrowAsJavaScriptException();
    return;
  }
  [PermissionManager requestPermission:(PermissionType)info[0].As<Napi::Number>().Int32Value()
                            completion:^(PermissionStatus status) {
    NSLog(@"Permission request completed with status: %ld", (long)status);
  }];
}

Napi::Object NativeWindows(Napi::Env env, Napi::Object exports) {
  RegisterReminders(env, exports);
  exports.Set(Napi::String::New(env, "startActiveWindowObserver"), Napi::Function::New(env, StartActiveWindowObserverMethod));
  exports.Set(Napi::String::New(env, "stopActiveWindowObserver"), Napi::Function::New(env, StopActiveWindowObserverMethod));
  exports.Set(Napi::String::New(env, "setActivityCapturePaused"), Napi::Function::New(env, SetActivityCapturePausedMethod));
  exports.Set(Napi::String::New(env, "refreshActiveWindow"), Napi::Function::New(env, RefreshActiveWindowMethod));
  exports.Set(Napi::String::New(env, "resumeAfterSystemSuspension"), Napi::Function::New(env, ResumeAfterSystemSuspensionMethod));
  exports.Set(Napi::String::New(env, "getAppIconPath"), Napi::Function::New(env, GetAppIconPathMethod));
  exports.Set(Napi::String::New(env, "setFirefoxNavigationState"), Napi::Function::New(env, SetFirefoxNavigationStateMethod));
  exports.Set(Napi::String::New(env, "captureFirefoxNavigation"), Napi::Function::New(env, CaptureFirefoxNavigationMethod));
  exports.Set(Napi::String::New(env, "setFirefoxCompanionConnected"), Napi::Function::New(env, SetFirefoxCompanionConnectedMethod));
  exports.Set(Napi::String::New(env, "setShouldRequestPermissions"), Napi::Function::New(env, SetShouldRequestPermissionsMethod));
  exports.Set(Napi::String::New(env, "getShouldRequestPermissions"), Napi::Function::New(env, GetShouldRequestPermissionsMethod));
  exports.Set(Napi::String::New(env, "getPermissionStatus"), Napi::Function::New(env, GetPermissionStatusMethod));
  exports.Set(Napi::String::New(env, "hasPermissionsForTitleExtraction"), Napi::Function::New(env, HasPermissionsForTitleExtractionMethod));
  exports.Set(Napi::String::New(env, "hasPermissionsForContentExtraction"), Napi::Function::New(env, HasPermissionsForContentExtractionMethod));
  exports.Set(Napi::String::New(env, "requestPermission"), Napi::Function::New(env, RequestPermissionMethod));
  return exports;
}

NODE_API_MODULE(nativeWindows, NativeWindows)
