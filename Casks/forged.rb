cask "forged" do
  arch arm: "arm64", intel: "x64"

  version "1.0.2"
  sha256 arm:   "a946df9114c9c5b9f308a125f3e33e2992f051999e9a77781351028d12341c0a",
         intel: "3a19e31026854cd2f91b331074af7676ef497c55d11e3c7c2bf98f4dd66c5b9e"

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
