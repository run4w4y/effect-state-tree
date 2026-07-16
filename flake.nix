{
  description = "Effect Tree State development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            chromium
            git
            nixfmt
            nodejs_22
            shellcheck
          ];

          shellHook = ''
            export EFFECT_TREE_CHROME_PATH="${pkgs.chromium}/bin/chromium"
            export NX_DAEMON=false
          '';
        };
      }
    );
}
