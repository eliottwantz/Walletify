//
//  ContentView.swift
//  Walletify
//
//  Created by Eliott on 07-03-2026.
//

import SwiftUI

struct ContentView: View {
  var body: some View {
    VStack {
      Image(systemName: "globe")
        .imageScale(.large)
        .foregroundStyle(.tint)
      Text("Hello, world!")
      #if DEBUG
        Text("Debug Build")
          .padding()
      #else
        Text("Release Build")
          .padding()
      #endif
    }
    .padding()
  }
}

#Preview {
  ContentView()
}
