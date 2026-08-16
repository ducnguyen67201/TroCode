import CoreGraphics
import Darwin
import Foundation

private let pollIntervalMicroseconds: useconds_t = 12_000
private var wasPressed = false

private func emit(_ value: String) {
  let data = Data("\(value)\n".utf8)
  try? FileHandle.standardOutput.write(contentsOf: data)
}

emit("ready")

while true {
  let flags = CGEventSource.flagsState(.combinedSessionState)
  let isPressed = flags.contains(.maskCommand) && flags.contains(.maskControl)

  if isPressed != wasPressed {
    wasPressed = isPressed
    emit(isPressed ? "pressed" : "released")
  }

  usleep(pollIntervalMicroseconds)
}
