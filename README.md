# Sqitch Studio 🚀

A modern, high-performance, and beautiful Desktop & Web GUI application for managing database migrations with [Sqitch](https://sqitch.org/).

Built with **Node.js**, **Express**, **WebSockets**, and a modern **Dark Glassmorphism** web interface.

![Sqitch Studio GUI](https://raw.githubusercontent.com/sqitch-studio/assets/main/preview.png)

---

## ✨ Features

- 📜 **Interactive Sqitch Plan Timeline (`sqitch.plan`)**: Visual timeline showing sequential database migration changes, release tags, dependencies, planner notes, and deployment status.
- 📝 **Multi-Tab SQL Script Editor**: Direct viewing and editing of `deploy/*.sql`, `revert/*.sql`, and `verify/*.sql` scripts with auto-save and tab navigation.
- ⚡ **Real-Time Streaming Terminal**: Live WebSocket command streaming output with colored logs for `sqitch status`, `sqitch deploy`, `sqitch revert`, and `sqitch verify`.
- ➕ **Change Creator (`sqitch add`)**: Form modal to easily generate new migration changes with dependencies (`--requires`), conflicts (`--conflicts`), notes, and SQL templates.
- 🎯 **Target & Engine Configurator**: Easily switch engines (PostgreSQL, MySQL, SQLite, Oracle, etc.) and database connection target URIs.
- 🔄 **3 Execution Engines Supported**:
  1. **Native CLI**: Executes installed system `sqitch` executable directly.
  2. **Docker Mode**: Runs Sqitch via official Docker container (`docker run -it sqitch/sqitch`).
  3. **Simulated / Demo Mode**: Built-in interactive simulation for exploring and testing Sqitch Studio GUI features without requiring pre-installed Perl or Sqitch binaries.

---

## 🛠️ Quick Start

### Prerequisites
- Node.js (v18+)

### Installation & Launch

1. **Clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/SQITCHGUI.git
   cd SQITCHGUI
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start Sqitch Studio**:
   ```bash
   npm start
   ```

4. **Open in Browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

---

## 🚀 How to Use

1. **View Migration Plan**: The left sidebar shows your project engine and metadata, while the central view lists all changes in `sqitch.plan`.
2. **Execute Migrations**: Click **Deploy All**, **Revert**, **Verify DB**, or **Check Status** to run Sqitch commands with live real-time output in the bottom terminal drawer.
3. **Edit SQL Files**: Click on any change row to open its `deploy.sql`, `revert.sql`, or `verify.sql` file in the built-in SQL Editor. Make changes and click **Save File**.
4. **Create New Migration**: Click **New Change (`sqitch add`)** to specify a change name, required dependencies, and note to generate new migration files.

---

## 📂 Project Structure

```
SQITCHGUI/
├── lib/
│   ├── sqitch-parser.js    # sqitch.plan & sqitch.conf parser
│   └── sqitch-runner.js    # Native, Docker, and Simulated Sqitch command runner
├── public/
│   ├── css/
│   │   └── style.css       # Dark Glassmorphism CSS design system
│   ├── js/
│   │   └── app.js          # Web App client logic & WebSocket log streamer
│   └── index.html          # Main Web Application UI layout
├── server.js               # Node.js Express REST API & WebSocket server
├── package.json            # Node.js project manifest
├── .gitignore              # Git ignore configuration
└── README.md               # Project documentation
```

---

## 📄 License

MIT License. Developed for easy and intuitive database migration management with Sqitch.
