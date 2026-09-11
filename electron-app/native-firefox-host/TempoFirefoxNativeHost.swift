import Foundation
import Darwin

/* Firefox native messaging uses length-prefixed UTF-8 JSON. This helper only
 * forwards extension messages to Tempo's mode-0600 Unix socket; it never
 * persists or logs URLs. */
let socketPath = FileManager.default.homeDirectoryForCurrentUser
  .appendingPathComponent("Library/Application Support/Tempo/firefox-native.sock")
  .path

func writeFrame(_ object: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object) else { return }
  var length = UInt32(data.count).littleEndian
  FileHandle.standardOutput.write(Data(bytes: &length, count: 4))
  FileHandle.standardOutput.write(data)
}

var tempoSocket: Int32 = -1

func closeTempoSocket() {
  if tempoSocket >= 0 { close(tempoSocket) }
  tempoSocket = -1
}

func connectToTempo() -> Bool {
  if tempoSocket >= 0 { return true }
  let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
  guard descriptor >= 0 else { return false }
  var noSigPipe: Int32 = 1
  _ = withUnsafePointer(to: &noSigPipe) {
    setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, $0, socklen_t(MemoryLayout<Int32>.size))
  }
  var address = sockaddr_un()
  address.sun_family = sa_family_t(AF_UNIX)
  let maxPathLength = MemoryLayout.size(ofValue: address.sun_path) - 1
  socketPath.withCString { source in
    withUnsafeMutablePointer(to: &address.sun_path) { target in
      strncpy(UnsafeMutableRawPointer(target).assumingMemoryBound(to: CChar.self), source, maxPathLength)
    }
  }
  let result = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard result == 0 else {
    close(descriptor)
    return false
  }
  tempoSocket = descriptor
  // This persistent local connection is also the companion health signal.
  // It contains no page data and lets Tempo stop its fallback CG polling.
  let lifecycle = Data("{\"type\":\"companion_lifecycle\",\"state\":\"connected\"}\n".utf8)
  let sent = lifecycle.withUnsafeBytes { bytes -> ssize_t in
    guard let base = bytes.baseAddress else { return -1 }
    return send(tempoSocket, base, bytes.count, 0)
  }
  if sent < 0 {
    closeTempoSocket()
    return false
  }
  return true
}

func forward(_ data: Data) {
  guard connectToTempo() else { return }
  let sent = data.withUnsafeBytes { bytes -> ssize_t in
    guard let base = bytes.baseAddress else { return -1 }
    return send(tempoSocket, base, bytes.count, 0)
  }
  guard sent >= 0, send(tempoSocket, "\n", 1, 0) >= 0 else {
    closeTempoSocket()
    return
  }
}

var buffer = Data()
while true {
  let data = FileHandle.standardInput.availableData
  if data.isEmpty { break }
  buffer.append(data)
  while buffer.count >= 4 {
    let length = buffer.prefix(4).withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
    guard buffer.count >= Int(length) + 4 else { break }
    let message = buffer.subdata(in: 4..<(4 + Int(length)))
    buffer.removeSubrange(0..<(4 + Int(length)))
    forward(message)
    writeFrame(["ok": true])
  }
}
closeTempoSocket()
