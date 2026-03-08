import PassKit
import SwiftUI

struct AddToWalletSheet: UIViewControllerRepresentable {
  let pass: PKPass

  func makeUIViewController(context _: Context) -> UIViewController {
    guard let controller = PKAddPassesViewController(pass: pass) else {
      return UIViewController()
    }
    return controller
  }

  func updateUIViewController(_: UIViewController, context _: Context) {}
}
