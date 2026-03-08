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
  @State private var scannedCode: String?
  @State private var isScannerPresented = false
  @State private var isLoading = false
  @State private var addPass: WalletPassItem?
  @State private var errorMessage: String?

  private let passService = WalletPassService()

  var body: some View {
    NavigationStack {
      Form {
        Section("Card details") {
          TextField("Company name", text: $companyName)
            .textInputAutocapitalization(.words)

          if let scannedCode {
            LabeledContent("Code", value: scannedCode)
              .font(.footnote)
              .textSelection(.enabled)
          } else {
            Text("No code scanned yet")
              .foregroundStyle(.secondary)
          }
        }

        Section {
          Button("Scan QR / Bar code") {
            isScannerPresented = true
          }

          Button("Save to Apple Wallet") {
            Task {
              await saveToWallet()
            }
          }
          .disabled(isSaveDisabled)
        }
      }
      .navigationTitle("Walletify")
      .overlay {
        if isLoading {
          ProgressView("Preparing pass…")
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
      }
      .sheet(isPresented: $isScannerPresented) {
        BarcodeScannerView(
          onCodeFound: { code in
            scannedCode = code
            isScannerPresented = false
            errorMessage = nil
          },
          onCancel: {
            isScannerPresented = false
          }
        )
      }
      .sheet(item: $addPass) { pass in
        AddToWalletSheet(pass: pass.pass)
      }
      .alert("Could not save to Wallet", isPresented: .constant(errorMessage != nil), actions: {
        Button("OK") { errorMessage = nil }
      }, message: {
        Text(errorMessage ?? "Unknown error")
      })
    }
  }

  private var isSaveDisabled: Bool {
    companyName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || scannedCode == nil || isLoading
  }

  @MainActor
  private func saveToWallet() async {
    guard let scannedCode else { return }
    isLoading = true
    defer { isLoading = false }

    do {
      let pass = try await passService.createPass(companyName: companyName, codeValue: scannedCode)
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

#Preview {
  ContentView()
}
