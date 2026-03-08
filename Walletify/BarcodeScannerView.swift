//
//  BarcodeScannerView.swift
//  Walletify
//
//  Created by Eliott Wantz on 08-03-2026.
//  SPDX-License-Identifier: MIT
//

import AVFoundation
import SwiftUI
import Vision

private enum BarcodeDetectionResult: Sendable {
  case code(String)
  case notFound
  case failure(String)
}

struct BarcodeScannerView: UIViewControllerRepresentable {
  let onCodeFound: (String) -> Void
  let onCancel: () -> Void

  func makeUIViewController(context: Context) -> ScannerViewController {
    let controller = ScannerViewController()
    controller.onCodeFound = onCodeFound
    controller.onCancel = onCancel
    return controller
  }

  func updateUIViewController(_: ScannerViewController, context _: Context) {}
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate,
  AVCapturePhotoCaptureDelegate
{
  var onCodeFound: ((String) -> Void)?
  var onCancel: (() -> Void)?

  private let session = AVCaptureSession()
  private let previewView = UIView()
  private let photoOutput = AVCapturePhotoOutput()
  private let metadataOutput = AVCaptureMetadataOutput()
  private let statusLabel = UILabel()
  private let captureButton = UIButton(type: .system)
  private let closeButton = UIButton(type: .system)

  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var isSessionConfigured = false
  private var isProcessingCapture = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    setupLayout()
    configureCameraAccess()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = previewView.bounds
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    guard isSessionConfigured else { return }

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

  private func setupLayout() {
    previewView.translatesAutoresizingMaskIntoConstraints = false
    previewView.backgroundColor = .black
    view.addSubview(previewView)

    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    statusLabel.font = .preferredFont(forTextStyle: .subheadline)
    statusLabel.layer.cornerRadius = 12
    statusLabel.layer.masksToBounds = true
    statusLabel.numberOfLines = 0
    statusLabel.text = "Center the code, or tap the camera button to take a photo."
    statusLabel.textAlignment = .center
    statusLabel.textColor = .white
    view.addSubview(statusLabel)

    captureButton.translatesAutoresizingMaskIntoConstraints = false
    captureButton.backgroundColor = .white
    captureButton.layer.cornerRadius = 34
    captureButton.tintColor = .black
    captureButton.isEnabled = false
    captureButton.alpha = 0.5
    captureButton.accessibilityLabel = "Take photo"
    captureButton.setImage(UIImage(systemName: "camera.fill"), for: .normal)
    captureButton.addTarget(self, action: #selector(capturePhoto), for: .touchUpInside)
    view.addSubview(captureButton)

    closeButton.translatesAutoresizingMaskIntoConstraints = false
    closeButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    closeButton.layer.cornerRadius = 22
    closeButton.tintColor = .white
    closeButton.accessibilityLabel = "Close scanner"
    closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
    closeButton.addTarget(self, action: #selector(closeScanner), for: .touchUpInside)
    view.addSubview(closeButton)

    NSLayoutConstraint.activate([
      previewView.topAnchor.constraint(equalTo: view.topAnchor),
      previewView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      previewView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      previewView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

      closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      closeButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
      closeButton.widthAnchor.constraint(equalToConstant: 44),
      closeButton.heightAnchor.constraint(equalToConstant: 44),

      captureButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      captureButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -28),
      captureButton.widthAnchor.constraint(equalToConstant: 68),
      captureButton.heightAnchor.constraint(equalToConstant: 68),

      statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      statusLabel.bottomAnchor.constraint(equalTo: captureButton.topAnchor, constant: -24),
    ])
  }

  private func configureCameraAccess() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      configureSession()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        Task { @MainActor [weak self] in
          guard let self else { return }

          if granted {
            self.configureSession()
          } else {
            self.showUnavailableState(message: "Camera access is required to scan codes.")
          }
        }
      }
    default:
      showUnavailableState(message: "Enable camera access in Settings to scan codes.")
    }
  }

  private func configureSession() {
    guard !isSessionConfigured else {
      if !session.isRunning {
        session.startRunning()
      }
      return
    }

    guard
      let device = AVCaptureDevice.default(for: .video),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      showUnavailableState(message: "Unable to access the camera.")
      return
    }

    session.beginConfiguration()
    session.sessionPreset = .photo
    session.addInput(input)

    guard session.canAddOutput(metadataOutput), session.canAddOutput(photoOutput) else {
      session.commitConfiguration()
      showUnavailableState(message: "Unable to configure barcode scanning.")
      return
    }

    session.addOutput(metadataOutput)
    session.addOutput(photoOutput)
    metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
    metadataOutput.metadataObjectTypes = [.qr, .ean8, .ean13, .code128, .pdf417, .aztec]
    session.commitConfiguration()
    isSessionConfigured = true

    let previewLayer = AVCaptureVideoPreviewLayer(session: session)
    previewLayer.videoGravity = .resizeAspectFill
    previewLayer.frame = previewView.bounds
    previewView.layer.addSublayer(previewLayer)
    self.previewLayer = previewLayer
    captureButton.isEnabled = true
    captureButton.alpha = 1
    session.startRunning()
  }

  private func showUnavailableState(message: String) {
    statusLabel.text = message
    captureButton.isEnabled = false
    captureButton.alpha = 0.5
  }

  @objc
  private func capturePhoto() {
    guard isSessionConfigured, !isProcessingCapture else { return }

    isProcessingCapture = true
    captureButton.isEnabled = false
    statusLabel.text = "Capturing photo…"

    let settings = AVCapturePhotoSettings()
    if photoOutput.supportedFlashModes.contains(.auto) {
      settings.flashMode = .auto
    }
    photoOutput.capturePhoto(with: settings, delegate: self)
  }

  @objc
  private func closeScanner() {
    onCancel?()
  }

  private func handleDetectedCode(_ value: String) {
    if session.isRunning {
      session.stopRunning()
    }

    onCodeFound?(value)
  }

  private func handlePhotoCaptureResult(imageData: Data?, errorMessage: String?) {
    if let errorMessage {
      isProcessingCapture = false
      captureButton.isEnabled = isSessionConfigured
      captureButton.alpha = isSessionConfigured ? 1 : 0.5
      statusLabel.text = errorMessage
      return
    }

    guard let imageData else {
      isProcessingCapture = false
      captureButton.isEnabled = isSessionConfigured
      captureButton.alpha = isSessionConfigured ? 1 : 0.5
      statusLabel.text = "Unable to process the captured photo."
      return
    }

    statusLabel.text = "Looking for a code…"
    detectBarcode(in: imageData)
  }

  private func detectBarcode(in imageData: Data) {
    Task { [weak self, imageData] in
      let result = await Self.detectBarcodeResult(in: imageData)
      guard let self else { return }

      self.isProcessingCapture = false
      self.captureButton.isEnabled = self.isSessionConfigured
      self.captureButton.alpha = self.isSessionConfigured ? 1 : 0.5

      switch result {
      case let .code(value):
        self.handleDetectedCode(value)
      case .notFound:
        self.statusLabel.text = "No QR or bar code found. Try again."
      case let .failure(message):
        self.statusLabel.text = message
      }
    }
  }

  private static func detectBarcodeResult(in imageData: Data) async -> BarcodeDetectionResult {
    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr, .ean8, .ean13, .code128, .pdf417, .aztec]

        do {
          try VNImageRequestHandler(data: imageData).perform([request])

          let observations = request.results ?? []
          if let value = observations.compactMap(\.payloadStringValue).first {
            continuation.resume(returning: .code(value))
          } else {
            continuation.resume(returning: .notFound)
          }
        } catch {
          continuation.resume(returning: .failure(error.localizedDescription))
        }
      }
    }
  }

  nonisolated func metadataOutput(
    _: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from _: AVCaptureConnection
  ) {
    guard
      let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
      let value = metadataObject.stringValue
    else { return }

    Task { @MainActor [weak self] in
      guard let self, !self.isProcessingCapture else { return }
      self.handleDetectedCode(value)
    }
  }

  nonisolated func photoOutput(
    _: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: Error?
  ) {
    let imageData = photo.fileDataRepresentation()
    let errorMessage = error?.localizedDescription

    Task { @MainActor [weak self] in
      self?.handlePhotoCaptureResult(imageData: imageData, errorMessage: errorMessage)
    }
  }
}
