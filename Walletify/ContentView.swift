//
//  ContentView.swift
//  Walletify
//
//  Created by Eliott Wantz on 07-03-2026.
//  SPDX-License-Identifier: MIT
//

import AVFoundation
import PassKit
import SwiftUI
import Vision

struct ContentView: View {
  @State private var companyName = ""
  @State private var websiteURL = ""
  @State private var codeValue = ""
  @State private var detectedBarcodeType: VNBarcodeSymbology?
  @State private var isScannerPresented = false
  @State private var isLoading = false
  @State private var addPass: WalletPassItem?
  @State private var errorMessage: String?

  @FocusState private var isKeyboardFocused: Bool

  private let passService = WalletPassService()
  var body: some View {
    NavigationStack {
      VStack {
        Form {
          Section("Card details") {
            TextField("Company name", text: $companyName)
              .textInputAutocapitalization(.words)
              .focused($isKeyboardFocused)

            TextField("Website URL (optional)", text: $websiteURL)
              .keyboardType(.URL)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .focused($isKeyboardFocused)
          }

          Section("Scanned code") {
            if let detectedBarcodeType {
              LabeledContent("Type", value: BarcodeScanResult.displayName(for: detectedBarcodeType))
                .font(.footnote)
            } else {
              Text("Scan a code to detect its format before saving.")
                .foregroundStyle(.secondary)
            }

            LabeledContent("Code", value: codeValue)
              .textSelection(.enabled)
              .foregroundStyle(codeValue.isEmpty ? .secondary : .primary)
            Button {
              isScannerPresented = true
            } label: {
              Label("Scan QR / Bar code", systemImage: "qrcode.viewfinder")
            }
          }
        }

        Spacer()

        Button {
          Task {
            await saveToWallet()
          }
        } label: {
          Label("Add to Apple Wallet", systemImage: "wallet.bifold")
            .padding(.vertical, 8)
        }
        .buttonStyle(.glassProminent)
        .buttonSizing(.flexible)
        .disabled(isSaveDisabled)
        .padding(.horizontal)
        .padding(.bottom, 20)
      }
      .ignoresSafeArea(.keyboard, edges: .bottom)
      .navigationTitle("Walletify")
      .overlay {
        if isLoading {
          ProgressView("Preparing pass…")
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
      }
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button {
            isKeyboardFocused = false
          } label: {
            Label("Dismiss keyboard", systemImage: "keyboard.chevron.compact.down")
              .labelStyle(.iconOnly)
          }
        }
      }
      .fullScreenCover(isPresented: $isScannerPresented) {
        BarcodeScannerView(
          onCodeFound: { result in
            codeValue = result.code
            detectedBarcodeType = result.detectedType
            isScannerPresented = false
            errorMessage = nil
          },
          onCancel: {
            isScannerPresented = false
          }
        )
        .ignoresSafeArea()
      }
      .sheet(item: $addPass) { pass in
        AddToWalletSheet(pass: pass.pass)
          .interactiveDismissDisabled()
      }
      .alert(
        "Could not save to Wallet", isPresented: .constant(errorMessage != nil)
      ) {
        Button("OK") { errorMessage = nil }
      } message: {
        Text(errorMessage ?? "Unknown error")
      }
    }
  }

  private var isSaveDisabled: Bool {
    companyName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      || codeValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      || detectedBarcodeType == nil
      || isLoading
  }

  @MainActor
  private func saveToWallet() async {
    guard let detectedBarcodeType else { return }
    isLoading = true
    defer { isLoading = false }

    do {
      let pass = try await passService.createPass(
        companyName: companyName,
        codeValue: codeValue,
        detectedType: detectedBarcodeType.rawValue,
        websiteURL: websiteURL
      )
      addPass = WalletPassItem(pass: pass)
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }
}

private struct WalletPassItem: Identifiable {
  let id = UUID()
  let pass: PKPass
}

extension BarcodeScanResult {
  fileprivate static func displayName(for symbology: VNBarcodeSymbology) -> String {
    switch symbology {
    case .qr:
      return "QR Code"
    case .microQR:
      return "Micro QR"
    case .aztec:
      return "Aztec"
    case .pdf417:
      return "PDF417"
    case .microPDF417:
      return "MicroPDF417"
    case .dataMatrix:
      return "Data Matrix"
    case .ean13:
      return "EAN-13"
    case .ean8:
      return "EAN-8"
    case .upce:
      return "UPC-E"
    case .code39, .code39Checksum, .code39FullASCII, .code39FullASCIIChecksum:
      return "Code 39"
    case .code93, .code93i:
      return "Code 93"
    case .code128:
      return "Code 128"
    case .codabar:
      return "Codabar"
    case .itf14:
      return "ITF-14"
    case .i2of5, .i2of5Checksum:
      return "Interleaved 2 of 5"
    case .gs1DataBar:
      return "GS1 DataBar"
    case .gs1DataBarExpanded:
      return "GS1 DataBar Expanded"
    case .gs1DataBarLimited:
      return "GS1 DataBar Limited"
    default:
      let normalizedType = symbology.rawValue
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "VNBarcodeSymbology", with: "")
      return normalizedType.isEmpty ? symbology.rawValue : normalizedType
    }
  }
}

#Preview {
  ContentView()
}
