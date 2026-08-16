import Foundation
import Vision

private struct RecognizedTextBox: Codable {
  let confidence: Float
  let height: Double
  let text: String
  let width: Double
  let x: Double
  let y: Double
}

private func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(1)
}

let imageData = FileHandle.standardInput.readDataToEndOfFile()
if imageData.isEmpty {
  fail("No screenshot data was provided.")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US", "vi-VN"]
request.usesLanguageCorrection = true

do {
  let handler = VNImageRequestHandler(data: imageData, options: [:])
  try handler.perform([request])

  let observations: [VNRecognizedTextObservation] = request.results ?? []
  let boxes: [RecognizedTextBox] = observations.compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else {
      return nil
    }
    let bounds = observation.boundingBox
    return RecognizedTextBox(
      confidence: candidate.confidence,
      height: bounds.height,
      text: candidate.string,
      width: bounds.width,
      x: bounds.origin.x,
      y: bounds.origin.y
    )
  }

  let encoded = try JSONEncoder().encode(boxes)
  FileHandle.standardOutput.write(encoded)
  FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
  fail("Vision OCR failed: \(error.localizedDescription)")
}
