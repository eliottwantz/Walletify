//
//  BarcodeScannerView.swift
//  Walletify
//
//  Created by Eliott Wantz on 08-03-2026.
//  SPDX-License-Identifier: MIT
//

import AVFoundation
import Observation
import SwiftUI
import Vision
import VisionKit

struct BarcodeScanResult: Sendable {
  let code: String
  let detectedType: VNBarcodeSymbology
}

struct BarcodeScannerView: View {
  let onCancel: () -> Void

  @State private var model: BarcodeScannerModel

  init(
    onCodeFound: @escaping (BarcodeScanResult) -> Void,
    onCancel: @escaping () -> Void
  ) {
    self.onCancel = onCancel
    _model = State(initialValue: BarcodeScannerModel(onCodeFound: onCodeFound))
  }

  var body: some View {
    ZStack(alignment: .topTrailing) {
      Group {
        if model.showsScanner {
          BarcodeDataScannerView(
            isScanningEnabled: model.isScanningEnabled,
            onCodeFound: model.handleRecognizedCode,
            onScannerUnavailable: model.handleScannerUnavailable
          )
          .ignoresSafeArea()
          .statusBarHidden()
        } else {
          Color.black
            .ignoresSafeArea()
        }
      }

      VStack(spacing: 0) {
        HStack {
          Spacer()
          closeButton
        }

        Spacer()

        statusMessage
      }
      .padding(.horizontal, 20)
      .padding(.top, 16)
      .padding(.bottom, 36)
    }
    .background(.black)
    .task {
      await model.prepare()
    }
  }

  private var closeButton: some View {
    Button(action: onCancel) {
      Image(systemName: "xmark")
        .font(.headline)
        .frame(width: 44, height: 44)
        .foregroundStyle(.white)
        .background(.black.opacity(0.45), in: Circle())
    }
    .accessibilityLabel("Close scanner")
  }

  private var statusMessage: some View {
    Text(model.statusMessage)
      .font(.subheadline)
      .foregroundStyle(.white)
      .multilineTextAlignment(.center)
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .frame(maxWidth: .infinity)
      .background(.black.opacity(0.45), in: .rect(cornerRadius: 16))
  }
}

@MainActor
@Observable
private final class BarcodeScannerModel {
  @ObservationIgnored private let onCodeFound: (BarcodeScanResult) -> Void

  @ObservationIgnored private var hasPrepared = false

  @ObservationIgnored private var hasDeliveredResult = false

  private enum Availability {
    case checking
    case ready
    case unavailable
  }

  private static let readyMessage = "Center the QR or bar code within the frame."

  var statusMessage = "Preparing camera..."
  var isScanningEnabled = false
  private var availability: Availability = .checking

  var showsScanner: Bool {
    availability == .ready
  }

  init(onCodeFound: @escaping (BarcodeScanResult) -> Void) {
    self.onCodeFound = onCodeFound
  }

  func prepare() async {
    guard !hasPrepared else { return }
    hasPrepared = true

    guard DataScannerViewController.isSupported else {
      handleScannerUnavailable("Barcode scanning is not supported on this device.")
      return
    }

    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      finishAuthorization(granted: true)
    case .notDetermined:
      statusMessage = "Requesting camera access..."
      let granted = await requestVideoAccess()
      finishAuthorization(granted: granted)
    case .denied, .restricted:
      handleScannerUnavailable("Enable camera access in Settings to scan codes.")
    @unknown default:
      handleScannerUnavailable("Camera access is required to scan codes.")
    }
  }

  func handleRecognizedCode(_ result: BarcodeScanResult) {
    guard !hasDeliveredResult else { return }

    hasDeliveredResult = true
    isScanningEnabled = false
    statusMessage = "Code detected."
    onCodeFound(result)
  }

  func handleScannerUnavailable(_ message: String) {
    availability = .unavailable
    isScanningEnabled = false
    statusMessage = message
  }

  private func finishAuthorization(granted: Bool) {
    guard granted else {
      handleScannerUnavailable("Camera access is required to scan codes.")
      return
    }

    guard DataScannerViewController.isAvailable else {
      handleScannerUnavailable("Barcode scanning is currently unavailable.")
      return
    }

    availability = .ready
    isScanningEnabled = true
    statusMessage = Self.readyMessage
  }

  private func requestVideoAccess() async -> Bool {
    await withCheckedContinuation { continuation in
      AVCaptureDevice.requestAccess(for: .video) { granted in
        continuation.resume(returning: granted)
      }
    }
  }
}

private struct BarcodeDataScannerView: UIViewControllerRepresentable {
  let isScanningEnabled: Bool
  let onCodeFound: (BarcodeScanResult) -> Void
  let onScannerUnavailable: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(
      onCodeFound: onCodeFound,
      onScannerUnavailable: onScannerUnavailable
    )
  }

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let controller = DataScannerViewController(
      recognizedDataTypes: [
        .barcode(symbologies: BarcodeScannerSymbologies.supportedVisionSymbologies)
      ],
      qualityLevel: .balanced,
      recognizesMultipleItems: false
    )
    controller.delegate = context.coordinator
    return controller
  }

  func updateUIViewController(
    _ controller: DataScannerViewController,
    context: Context
  ) {
    context.coordinator.onCodeFound = onCodeFound
    context.coordinator.onScannerUnavailable = onScannerUnavailable

    if isScanningEnabled {
      guard !controller.isScanning else { return }

      do {
        try controller.startScanning()
      } catch {
        onScannerUnavailable(Self.message(for: error))
      }
    } else if controller.isScanning {
      controller.stopScanning()
    }
  }

  static func dismantleUIViewController(
    _ controller: DataScannerViewController,
    coordinator _: Coordinator
  ) {
    if controller.isScanning {
      controller.stopScanning()
    }
  }

  private static func message(for error: Error) -> String {
    guard let unavailable = error as? DataScannerViewController.ScanningUnavailable else {
      return "Barcode scanning is currently unavailable."
    }

    switch unavailable {
    case .unsupported:
      return "Barcode scanning is not supported on this device."
    case .cameraRestricted:
      return "Camera access is required to scan codes."
    @unknown default:
      return "Barcode scanning is currently unavailable."
    }
  }

  @MainActor
  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    var onCodeFound: (BarcodeScanResult) -> Void
    var onScannerUnavailable: (String) -> Void

    private var hasRecognizedCode = false

    init(
      onCodeFound: @escaping (BarcodeScanResult) -> Void,
      onScannerUnavailable: @escaping (String) -> Void
    ) {
      self.onCodeFound = onCodeFound
      self.onScannerUnavailable = onScannerUnavailable
    }

    func dataScanner(
      _: DataScannerViewController,
      didAdd addedItems: [RecognizedItem],
      allItems _: [RecognizedItem]
    ) {
      forwardFirstBarcode(from: addedItems)
    }

    func dataScanner(
      _: DataScannerViewController,
      didUpdate updatedItems: [RecognizedItem],
      allItems _: [RecognizedItem]
    ) {
      forwardFirstBarcode(from: updatedItems)
    }

    func dataScanner(
      _: DataScannerViewController,
      becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable
    ) {
      onScannerUnavailable(BarcodeDataScannerView.message(for: error))
    }

    private func forwardFirstBarcode(from items: [RecognizedItem]) {
      guard !hasRecognizedCode else { return }
      guard let result = items.lazy.compactMap(Self.scanResult(from:)).first else { return }

      hasRecognizedCode = true
      onCodeFound(result)
    }

    private static func scanResult(from item: RecognizedItem) -> BarcodeScanResult? {
      guard case .barcode(let barcode) = item else { return nil }
      guard let payload = barcode.payloadStringValue else { return nil }

      return BarcodeScanResult(
        code: payload,
        detectedType: barcode.observation.symbology
      )
    }
  }
}

private enum BarcodeScannerSymbologies {
  static let supportedVisionSymbologies: [VNBarcodeSymbology] = [
    .qr,
    .aztec,
    .pdf417,
    .ean8,
    .ean13,
    .upce,
    .code39,
    .code39Checksum,
    .code39FullASCII,
    .code39FullASCIIChecksum,
    .code93,
    .code93i,
    .code128,
    .i2of5,
    .i2of5Checksum,
    .itf14,
    .codabar,
  ]
}
