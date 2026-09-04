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

func forward(_ data: Data) {
  let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
  guard descriptor >= 0 else { return }
  defer { close(descriptor) }
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
  guard result == 0 else { return }
  data.withUnsafeBytes { bytes in
    guard let base = bytes.baseAddress else { return }
    _ = send(descriptor, base, bytes.count, 0)
  }
  _ = send(descriptor, "\n", 1, 0)
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
