//
//  Environment.swift
//  Walletify
//
//  Created by Eliott Wantz on 20-03-2026.
//  SPDX-License-Identifier: MIT
//

import Foundation

enum Environment {
  static var API_URL: URL {
    #if DEBUG
      return URL(string: "https://local-walletify.develiott.com/pass")!
    #else
      return URL(string: "https://walletify.develiott.com/pass")!
    #endif
  }
}
