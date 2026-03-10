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

struct ContentView: View {
  @State private var companyName = ""
  @State private var websiteURL = ""
  @State private var codeValue = ""
  @State private var detectedBarcodeType: String?
  @State private var isScannerPresented = false
  @State private var isLoading = false
  @State private var addPass: WalletPassItem?
  @State private var errorMessage: String?

  @FocusState private var isKeyboardFocused: Bool

  private let passService = WalletPassService()

  #if DEBUG
    @ObserveInjection var forceRedraw
  #endif

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
              .font(.footnote.monospaced())
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
    .enableInjection()
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
        detectedType: detectedBarcodeType,
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
  fileprivate static func displayName(for rawValue: String) -> String {
    let normalizedType =
      rawValue
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .components(separatedBy: ".")
      .last ?? rawValue

    switch normalizedType {
    case "QR", "QRCode":
      return "QR Code"
    case "MicroQR":
      return "Micro QR"
    case "Aztec":
      return "Aztec"
    case "PDF417":
      return "PDF417"
    case "MicroPDF417":
      return "MicroPDF417"
    case "DataMatrix":
      return "Data Matrix"
    case "EAN13":
      return "EAN-13"
    case "EAN8":
      return "EAN-8"
    case "UPCE":
      return "UPC-E"
    case "Code39", "Code39Checksum", "Code39FullASCII", "Code39FullASCIIChecksum",
      "Code39Mod43":
      return "Code 39"
    case "Code93", "Code93i":
      return "Code 93"
    case "Code128":
      return "Code 128"
    case "Codabar":
      return "Codabar"
    case "ITF14":
      return "ITF-14"
    case "Interleaved2of5", "I2of5", "I2of5Checksum":
      return "Interleaved 2 of 5"
    case "GS1DataBar":
      return "GS1 DataBar"
    case "GS1DataBarExpanded":
      return "GS1 DataBar Expanded"
    case "GS1DataBarLimited":
      return "GS1 DataBar Limited"
    default:
      return normalizedType
    }
  }
}

#Preview {
  ContentView()
}
