.PHONY: all install build watch lint lint-fix typecheck test test-watch test-coverage clean package tag ensure-tag publish publish-vscode publish-openvsx help

# Token files (can be overridden via environment variables)
VSCE_PAT ?= $(shell cat ~/.vsce-token 2>/dev/null)
OVSX_PAT ?= $(shell cat ~/.ovsx-token 2>/dev/null)

# Package name and version derived from package.json
VERSION := $(shell node -p "require('./package.json').version")
VSIX_FILE := $(shell node -p "const p=require('./package.json'); p.name + '-' + p.version + '.vsix'")

# Default target
all: install build

# Install dependencies
install:
	npm install

# Build the extension
build:
	npm run build

# Watch mode for development
watch:
	npm run watch

# Run linter
lint:
	npm run lint

# Run linter with auto-fix
lint-fix:
	npm run lint:fix

# Type checking only (no emit)
typecheck:
	npm run typecheck

# Run tests
test:
	npm run test

# Run tests in watch mode
test-watch:
	npm run test:watch

# Run tests with coverage
test-coverage:
	npm run test:coverage

# Clean build artifacts
clean:
	rm -rf dist out node_modules coverage *.vsix

# Package the extension
package: clean install build
	npm run package

# Tag the current commit with the version and push
tag:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: Working directory is not clean. Commit changes first."; \
		exit 1; \
	fi
	@if git rev-parse v$(VERSION) >/dev/null 2>&1; then \
		echo "Tag v$(VERSION) already exists."; \
	else \
		git tag -a v$(VERSION) -m "Release v$(VERSION)"; \
		echo "Created tag v$(VERSION)"; \
	fi
	git push origin v$(VERSION)
	@echo "Pushed tag v$(VERSION) to origin"

# Ensure tag exists and HEAD matches it (creates tag if needed)
ensure-tag:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: Working directory is not clean. Commit changes first."; \
		exit 1; \
	fi
	@if git rev-parse v$(VERSION) >/dev/null 2>&1; then \
		if [ "$$(git rev-parse HEAD)" != "$$(git rev-parse v$(VERSION)^{commit})" ]; then \
			echo "Error: Tag v$(VERSION) exists but HEAD doesn't match it."; \
			echo "Either bump the version or checkout the tagged commit."; \
			exit 1; \
		fi; \
		echo "Tag v$(VERSION) exists and matches HEAD."; \
	else \
		git tag -a v$(VERSION) -m "Release v$(VERSION)"; \
		git push origin v$(VERSION); \
		echo "Created and pushed tag v$(VERSION)"; \
	fi

# Publish to VS Code marketplace (uses pre-built .vsix)
publish-vscode: ensure-tag package
	VSCE_PAT=$(VSCE_PAT) npx vsce publish --packagePath $(VSIX_FILE)

# Publish to Open VSX (uses pre-built .vsix)
publish-openvsx: ensure-tag package
	npx ovsx publish $(VSIX_FILE) -p $(OVSX_PAT)

# Publish to both marketplaces (same artifact to both)
publish: ensure-tag package
	VSCE_PAT=$(VSCE_PAT) npx vsce publish --packagePath $(VSIX_FILE)
	npx ovsx publish $(VSIX_FILE) -p $(OVSX_PAT)

# Check everything before committing
check: typecheck lint test
	@echo "All checks passed"

# Development setup
dev: install
	code --install-extension dbaeumer.vscode-eslint
	@echo "Development environment ready. Run 'make watch' to start developing."

# Help
help:
	@echo "Available targets:"
	@echo "  install      - Install npm dependencies"
	@echo "  build        - Build the extension"
	@echo "  watch        - Build and watch for changes"
	@echo "  lint         - Run ESLint"
	@echo "  lint-fix     - Run ESLint with auto-fix"
	@echo "  typecheck    - Run TypeScript type checking"
	@echo "  test         - Run tests"
	@echo "  test-watch   - Run tests in watch mode"
	@echo "  test-coverage - Run tests with coverage"
	@echo "  clean        - Remove build artifacts"
	@echo "  package          - Package extension as .vsix"
	@echo "  tag              - Tag current commit with version and push"
	@echo "  publish          - Publish to both marketplaces (requires tag)"
	@echo "  publish-vscode   - Publish to VS Code marketplace only"
	@echo "  publish-openvsx  - Publish to Open VSX only"
	@echo "  check            - Run all checks (typecheck, lint, test)"
	@echo "  dev          - Set up development environment"
