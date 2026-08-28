SHELL := /bin/bash
.DEFAULT_GOAL := check
VERSION ?= $(shell node -p "require('./package.json').version")
BUILD_NUMBER ?= 1
MARKETING_VERSION := $(if $(filter ci,$(VERSION)),$(shell node -p "require('./package.json').version"),$(VERSION))
APP := $(CURDIR)/dist/e-Akta Viewer.app
BUILT_APP := $(CURDIR)/DerivedData/ReleaseBuild/Build/Products/Release/e-Akta Viewer.app
ARCHIVE := $(CURDIR)/dist/e-Akta-Viewer-$(VERSION)-macos-universal-unsigned.zip

.PHONY: bootstrap start run verifier lint format-check typecheck test commitlint check trust-update app package smoke clean

bootstrap:
	npm ci
	bundle install
	RCT_NEW_ARCH_ENABLED=1 bundle exec pod install --project-directory=macos
	npx tsx scripts/assert-new-architecture.ts

start: verifier
	RCT_NEW_ARCH_ENABLED=1 npm start

run: verifier
	RCT_NEW_ARCH_ENABLED=1 npx react-native run-macos --scheme EaktaViewer-macOS

verifier:
	npm run verifier

lint:
	npm run lint

format-check:
	npm run format-check

typecheck:
	npm run typecheck

test:
	npm test -- --runInBand

commitlint:
	npx commitlint $(COMMITLINT_ARGS)

check:
	npm run source-policy
	npx tsx scripts/assert-new-architecture.ts
	npx tsx scripts/check-verifier-reproducible.ts
	if [[ "$$(uname -s)" == "Darwin" ]]; then npx tsx scripts/test-native-policy.ts && swift scripts/quicklook-readiness-smoke.swift; fi
	$(MAKE) lint
	$(MAKE) format-check
	$(MAKE) typecheck
	$(MAKE) test

trust-update:
	npm run trust-update

app: verifier
	mkdir -p dist
	rm -rf '$(APP)'
	RCT_NEW_ARCH_ENABLED=1 xcodebuild \
		-workspace macos/EaktaViewer.xcworkspace \
		-scheme EaktaViewer-macOS \
		-configuration Release \
		-destination 'generic/platform=macOS' \
		-derivedDataPath '$(CURDIR)/DerivedData/ReleaseBuild' \
		ARCHS='arm64 x86_64' \
		ONLY_ACTIVE_ARCH=NO \
		MARKETING_VERSION='$(MARKETING_VERSION)' \
		CURRENT_PROJECT_VERSION='$(BUILD_NUMBER)' \
		build
	ditto '$(BUILT_APP)' '$(APP)'
	npx tsx scripts/sign-app.ts '$(APP)'
	npx tsx scripts/verify-universal.ts '$(APP)'

package: app
	rm -f '$(ARCHIVE)'
	ditto -c -k --sequesterRsrc --keepParent '$(APP)' '$(ARCHIVE)'

smoke:
	npx tsx scripts/smoke.ts

clean:
	rm -rf DerivedData dist macos/build src/verifier/verifierBundle.generated.ts
