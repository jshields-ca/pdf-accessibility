#!/bin/bash

# PDF Accessibility Tool Installation Script
echo "🔧 Installing PDF Accessibility Tool..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16+ is required. Current version: $(node -v)"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install Node.js dependencies"
    exit 1
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip3 install -r requirements.txt

if [ $? -ne 0 ]; then
    echo "❌ Failed to install Python dependencies"
    echo "💡 Try: pip3 install --user -r requirements.txt"
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p uploads output reports logs

# Create environment file if it doesn't exist
if [ ! -f .env ]; then
    echo "⚙️ Creating environment configuration..."
    cp .env.example .env
    echo "✅ Created .env file - please review and modify as needed"
fi

# Set permissions
chmod +x install.sh
chmod 755 uploads output reports logs

echo ""
echo "🎉 Installation completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Review and edit .env file if needed"
echo "2. Start the application:"
echo "   npm start"
echo ""
echo "3. Open your browser to:"
echo "   http://localhost:3000"
echo ""
echo "🚀 Ready to make PDFs accessible!"

# Optional: Start the application
read -p "🤔 Would you like to start the application now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Starting PDF Accessibility Tool..."
    npm start
fi