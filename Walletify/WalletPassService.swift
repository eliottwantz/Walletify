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
  private let endpoint = Environment.API_URL

  func createPass(
    companyName: String,
    codeValue: String,
    detectedType: String,
    websiteURL: String
  ) async throws -> PKPass {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/vnd.apple.pkpass", forHTTPHeaderField: "Accept")
    let trimmedWebsiteURL = websiteURL.trimmingCharacters(in: .whitespacesAndNewlines)
    request.httpBody = try JSONEncoder().encode(
      CreatePassRequest(
        company: companyName,
        code: codeValue,
        detectedType: detectedType,
        website: trimmedWebsiteURL.isEmpty ? nil : trimmedWebsiteURL
      )
    )

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw WalletPassError.passGenerationFailed
    }

    guard httpResponse.statusCode == 200 else {
      if let serviceError = try? JSONDecoder().decode(PassServiceErrorResponse.self, from: data) {
        throw WalletPassError.serviceError(serviceError.error)
      }
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
  case serviceError(String)

  var errorDescription: String? {
    switch self {
    case .invalidEndpoint:
      "Wallet endpoint is invalid."
    case .passGenerationFailed:
      "The pass service could not generate a Wallet pass."
    case .invalidPassData:
      "Wallet pass data is invalid."
    case let .serviceError(message):
      message
    }
  }
}

private struct CreatePassRequest: Encodable {
  let company: String
  let code: String
  let detectedType: String
  let website: String?
}

private struct PassServiceErrorResponse: Decodable {
  let error: String
}
