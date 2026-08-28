import Darwin
import Foundation
import QuickLookThumbnailing

let manager = FileManager.default
let directory = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
try manager.createDirectory(at: directory, withIntermediateDirectories: false)
defer { try? manager.removeItem(at: directory) }

let file = directory.appendingPathComponent("corrupt.pdf")
try Data("not a pdf".utf8).write(to: file, options: .atomic)
let request = QLThumbnailGenerator.Request(
  fileAt: file,
  size: CGSize(width: 256, height: 256),
  scale: 1,
  representationTypes: .thumbnail
)
let semaphore = DispatchSemaphore(value: 0)
var incorrectlyReady = false
QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, error in
  incorrectlyReady = representation != nil && error == nil
  semaphore.signal()
}

if semaphore.wait(timeout: .now() + 5) == .timedOut {
  QLThumbnailGenerator.shared.cancel(request)
  exit(0)
}
exit(incorrectlyReady ? 1 : 0)
