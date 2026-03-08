//
//  WalletPassService.swift
//  Walletify
//
//  Created by Eliott Wantz on 08-03-2026.
//  SPDX-License-Identifier: MIT
//

import Foundation
import PassKit

struct WalletPassService {
  private let endpoint = URL(string: "https://walletify-pass-service.example.com/pass")!

  func createPass(companyName: String, codeValue: String) async throws -> PKPass {
    var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
    components?.queryItems = [
      URLQueryItem(name: "company", value: companyName),
      URLQueryItem(name: "code", value: codeValue),
    ]

    guard let url = components?.url else {
      throw WalletPassError.invalidEndpoint
    }

    let (data, response) = try await URLSession.shared.data(from: url)

    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
      throw WalletPassError.passGenerationFailed
    }

    do {
      return try PKPass(data: data)
    } catch {
      throw WalletPassError.invalidPassData
    }
  }
}

enum WalletPassError: LocalizedError {
  case invalidEndpoint
  case passGenerationFailed
  case invalidPassData

  var errorDescription: String? {
    switch self {
    case .invalidEndpoint:
      "Wallet endpoint is invalid."
    case .passGenerationFailed:
      "The pass service could not generate a Wallet pass."
    case .invalidPassData:
      "Wallet pass data is invalid."
    }
  }
}
