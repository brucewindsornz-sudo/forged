cask "forged" do
  arch arm: "arm64", intel: "x64"

  version "1.0.0"
  sha256 arm:   "f7b4cbe1c0f9bb9df0d1d66bfa633efb7e6b0ebb6e85c4e4fbd5b5f18e8fbbda",
         intel: "c145bfd8589221bb181092a2d12c20de2e9f132e9cb08117c0b5351c7eb1f293"

  url "https://github.com/brucewindsornz-sudo/forged/releases/download/v#{version}/Forged-#{version}-#{arch}-mac.zip"
  name "Forged"
  desc "Layered photo editor"
  homepage "https://github.com/brucewindsornz-sudo/forged"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "Forged.app"

  # Forged isn't notarised by Apple, so clear the download flag and
  # re-sign it locally so macOS doesn't offer to move it to the Bin.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Forged.app"]
    system_command "/usr/bin/codesign",
                   args: ["--force", "--deep", "--sign", "-", "#{appdir}/Forged.app"]
  end

  zap trash: [
    "~/Library/Application Support/Forged",
    "~/Library/Preferences/net.newzeebuild.forged.plist",
    "~/Library/Saved Application State/net.newzeebuild.forged.savedState",
  ]
end
