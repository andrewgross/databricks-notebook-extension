.PHONY: all install build watch lint lint-fix typecheck test test-watch test-coverage clean package publish help

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
package: build
	npm run package

# Publish to marketplace (requires VSCE_PAT env var)
publish: build
	npm run publish

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
	@echo "  package      - Package extension as .vsix"
	@echo "  publish      - Publish to VS Code marketplace"
	@echo "  check        - Run all checks (typecheck, lint, test)"
	@echo "  dev          - Set up development environment"
