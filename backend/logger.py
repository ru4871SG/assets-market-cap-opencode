"""
Centralized Logger Module

This module provides a unified logging system that:
- Creates a new timestamped log file on each application start
- Logs to both console and file
- Captures Flask/Werkzeug HTTP request logs as well

Log files are saved to: backend/logs/logs_YYYY-MM-DDTHHMMSS.txt
"""

import logging
import os
from datetime import datetime

# Module-level storage for the shared file handler and log filename
_file_handler = None
_log_filename = None
_initialized = False


def _get_log_filename() -> str:
    """Generate a timestamped log filename (no colons for Windows compatibility)."""
    timestamp = datetime.now().strftime('%Y-%m-%dT%H%M%S')
    return f'logs_{timestamp}.txt'


def _ensure_log_dir() -> str:
    """Ensure the logs directory exists and return the path."""
    log_dir = os.path.join(os.path.dirname(__file__), 'logs')
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


def _get_file_handler() -> logging.FileHandler:
    """Get or create the shared file handler for all loggers."""
    global _file_handler, _log_filename
    
    if _file_handler is None:
        log_dir = _ensure_log_dir()
        _log_filename = _get_log_filename()
        log_path = os.path.join(log_dir, _log_filename)
        
        _file_handler = logging.FileHandler(log_path, encoding='utf-8')
        _file_handler.setLevel(logging.DEBUG)
        _file_handler.setFormatter(logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        ))
    
    return _file_handler


def setup_logger(name: str) -> logging.Logger:
    """
    Set up and return a logger with the given name.
    
    All loggers share the same file handler (same log file per application run)
    but each has its own console handler for module-specific prefixes.
    
    Args:
        name: The logger name (typically module name like 'app', 'stock_screener')
    
    Returns:
        Configured logger instance
    """
    global _initialized
    
    # On first call, also set up Flask/Werkzeug logging to file
    if not _initialized:
        _setup_werkzeug_logging()
        _initialized = True
    
    logger = logging.getLogger(name)
    
    # Avoid adding duplicate handlers if logger already exists
    if logger.handlers:
        return logger
    
    logger.setLevel(logging.DEBUG)
    
    # Console handler - keeps console output working as before
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter(
        f'[{name}] %(message)s'
    ))
    
    # File handler - shared across all loggers
    file_handler = _get_file_handler()
    
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)
    
    # Prevent propagation to root logger
    logger.propagate = False
    
    return logger


def _setup_werkzeug_logging():
    """
    Set up Werkzeug (Flask's HTTP server) to also log to our file.
    This captures the HTTP request logs like:
    127.0.0.1 - - [28/Jan/2026 13:35:55] "GET /api/metals HTTP/1.1" 200 -
    """
    file_handler = _get_file_handler()
    
    # Werkzeug logger handles HTTP request logs
    werkzeug_logger = logging.getLogger('werkzeug')
    werkzeug_logger.setLevel(logging.INFO)
    werkzeug_logger.addHandler(file_handler)


def get_current_log_file() -> str | None:
    """Get the current log filename (useful for debugging)."""
    return _log_filename
