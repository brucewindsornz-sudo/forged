cask "forged" do
  arch arm: "arm64", intel: "x64"

  version "1.0.1"
  sha256 arm:   "8feedb6801d2c16a9e50f7a2ff1a7fa2a1e50dd102adababa3f28b0b7cdc0639",
         intel: "fbdba6d089fc70066b6a3c7ba93e5b2aac74d453b82512ebf5fcc7d1da132085"

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
