import AVFoundation
import SwiftUI

struct BarcodeScannerView: UIViewControllerRepresentable {
  let onCodeFound: (String) -> Void

  func makeUIViewController(context: Context) -> ScannerViewController {
    let controller = ScannerViewController()
    controller.onCodeFound = onCodeFound
    return controller
  }

  func updateUIViewController(_: ScannerViewController, context _: Context) {}
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  var onCodeFound: ((String) -> Void)?

  private let session = AVCaptureSession()
  private var previewLayer: AVCaptureVideoPreviewLayer?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    setupCapture()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.layer.bounds
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    if !session.isRunning {
      session.startRunning()
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if session.isRunning {
      session.stopRunning()
    }
  }

  private func setupCapture() {
    guard
      let device = AVCaptureDevice.default(for: .video),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      return
    }

    session.addInput(input)

    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else { return }
    session.addOutput(output)

    output.setMetadataObjectsDelegate(self, queue: .main)
    output.metadataObjectTypes = [.qr, .ean8, .ean13, .code128, .pdf417, .aztec]

    let previewLayer = AVCaptureVideoPreviewLayer(session: session)
    previewLayer.videoGravity = .resizeAspectFill
    view.layer.addSublayer(previewLayer)
    self.previewLayer = previewLayer
  }

  func metadataOutput(
    _: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from _: AVCaptureConnection
  ) {
    guard
      let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
      let value = metadataObject.stringValue
    else { return }

    session.stopRunning()
    onCodeFound?(value)
  }
}
