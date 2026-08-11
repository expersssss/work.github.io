import asyncio
import hashlib
import hmac
import json
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl

from aiohttp import web

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message,
    CallbackQuery,
    MenuButtonWebApp,
    WebAppInfo,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder


# ============================================================
# НАСТРОЙКИ
# ============================================================

TOKEN = os.getenv("BOT_TOKEN")

ADMIN_IDS = {
    5662322727,
}

# !!! НЕ GITHUB !!!
MINI_APP_URL = os.getenv(
    "MINI_APP_URL",
    "https://work-bot-h1go.onrender.com"
).rstrip("/")

HOST = "0.0.0.0"

PORT = int(
    os.getenv("PORT", "10000")
)

# Папка, где лежит этот файл
BASE_DIR = Path(__file__).resolve().parent

# Mini App:
# boti.py
# web/
#   index.html
#   app.js
#   style.css
WEB_DIR = BASE_DIR / "web"

DB_NAME = os.getenv(
    "DB_NAME",
    str(BASE_DIR / "vacancies.db")
)

MIN_AGE = 14
MAX_AGE = 50


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

logger = logging.getLogger(__name__)


# ============================================================
# ПРОВЕРКА ТОКЕНА
# ============================================================

if not TOKEN:
    raise RuntimeError(
        "Не задан BOT_TOKEN. "
        "Добавь BOT_TOKEN в Environment Variables Render."
    )


# ============================================================
# BOT
# ============================================================

bot = Bot(
    token=TOKEN,
    default=DefaultBotProperties(
        parse_mode=ParseMode.HTML
    )
)

dp = Dispatcher(
    storage=MemoryStorage()
)


# ============================================================
# DATABASE
# ============================================================

db = sqlite3.connect(
    DB_NAME,
    check_same_thread=False
)

db.row_factory = sqlite3.Row


def db_execute(query, params=()):
    cursor = db.cursor()
    cursor.execute(query, params)
    db.commit()
    return cursor


def db_fetchone(query, params=()):
    cursor = db.cursor()
    cursor.execute(query, params)
    return cursor.fetchone()


def db_fetchall(query, params=()):
    cursor = db.cursor()
    cursor.execute(query, params)
    return cursor.fetchall()


def column_exists(table_name, column_name):
    rows = db_fetchall(
        f"PRAGMA table_info({table_name})"
    )

    return any(
        row["name"] == column_name
        for row in rows
    )


def init_db():

    db_execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            phone TEXT,
            city TEXT,
            age INTEGER,
            blocked_until TEXT,
            spam_count INTEGER DEFAULT 0,
            start_count INTEGER DEFAULT 0,
            last_start TEXT,
            created_at TEXT
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS vacancies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT,
            salary TEXT,
            description TEXT,
            requirements TEXT,
            contact TEXT,
            employer_id INTEGER,
            created_at TEXT,
            active INTEGER DEFAULT 1
        )
    """)

    if not column_exists("vacancies", "employer_id"):
        db_execute(
            "ALTER TABLE vacancies ADD COLUMN employer_id INTEGER"
        )

    if not column_exists("vacancies", "active"):
        db_execute(
            "ALTER TABLE vacancies ADD COLUMN active INTEGER DEFAULT 1"
        )

    db_execute("""
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vacancy_id INTEGER,
            user_id INTEGER,
            name TEXT,
            age INTEGER,
            city TEXT,
            contact TEXT,
            message TEXT,
            created_at TEXT,
            status TEXT DEFAULT 'new'
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            vacancy_id INTEGER,
            created_at TEXT,
            UNIQUE(user_id, vacancy_id)
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS spam_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER,
            reason TEXT,
            created_at TEXT
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS broadcasts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            sent INTEGER DEFAULT 0,
            failed INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)


init_db()


# ============================================================
# USER HELPERS
# ============================================================

def get_user(telegram_id):
    return db_fetchone(
        """
        SELECT *
        FROM users
        WHERE telegram_id = ?
        """,
        (telegram_id,)
    )


def create_user_from_telegram(
    telegram_id,
    username=None,
    first_name=None,
    last_name=None
):

    existing = get_user(telegram_id)

    if existing:
        return existing

    db_execute("""
        INSERT INTO users (
            telegram_id,
            username,
            first_name,
            last_name,
            created_at
        )
        VALUES (?, ?, ?, ?, ?)
    """, (
        telegram_id,
        username,
        first_name,
        last_name,
        datetime.now().isoformat()
    ))

    return get_user(telegram_id)


def update_user(telegram_id, **kwargs):

    if not kwargs:
        return

    fields = []
    values = []

    for key, value in kwargs.items():

        fields.append(
            f"{key} = ?"
        )

        values.append(value)

    values.append(telegram_id)

    db_execute(
        f"""
        UPDATE users
        SET {", ".join(fields)}
        WHERE telegram_id = ?
        """,
        values
    )


# ============================================================
# HELPERS
# ============================================================

def row_to_dict(row):

    if row is None:
        return None

    return {
        key: row[key]
        for key in row.keys()
    }


def rows_to_list(rows):

    return [
        row_to_dict(row)
        for row in rows
    ]


def is_admin(user_id):

    return user_id in ADMIN_IDS


def json_response(data, status=200):

    return web.json_response(
        data,
        status=status,
        dumps=lambda obj: json.dumps(
            obj,
            ensure_ascii=False
        )
    )


# ============================================================
# TELEGRAM MINI APP AUTH
# ============================================================

def validate_telegram_init_data(init_data):

    if not init_data:
        return None

    try:

        parsed = dict(
            parse_qsl(
                init_data,
                keep_blank_values=True
            )
        )

        received_hash = parsed.pop(
            "hash",
            None
        )

        if not received_hash:
            return None

        data_check_string = "\n".join(
            f"{key}={parsed[key]}"
            for key in sorted(parsed)
        )

        secret_key = hmac.new(
            b"WebAppData",
            TOKEN.encode(),
            hashlib.sha256
        ).digest()

        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(
            calculated_hash,
            received_hash
        ):
            return None

        user_json = parsed.get("user")

        if not user_json:
            return None

        return json.loads(user_json)

    except Exception as error:

        logger.exception(
            "Mini App auth error: %s",
            error
        )

        return None


async def get_miniapp_user(request):

    init_data = request.headers.get(
        "X-Telegram-Init-Data"
    )

    # Дополнительная поддержка:
    # некоторые клиенты могут передавать initData
    # через query string.
    if not init_data:
        init_data = request.query.get(
            "initData",
            ""
        )

    user_data = validate_telegram_init_data(
        init_data
    )

    if not user_data:
        return None

    telegram_id = user_data.get("id")

    if not telegram_id:
        return None

    create_user_from_telegram(
        telegram_id,
        user_data.get("username"),
        user_data.get("first_name"),
        user_data.get("last_name")
    )

    return user_data


# ============================================================
# API: ME
# ============================================================

async def api_me(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    db_user = get_user(
        user["id"]
    )

    return json_response({
        "ok": True,
        "user": row_to_dict(db_user),
        "is_admin": is_admin(
            user["id"]
        )
    })


# ============================================================
# API: CATEGORIES
# ============================================================

async def api_categories(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    rows = db_fetchall("""
        SELECT
            category,
            COUNT(*) AS count
        FROM vacancies
        WHERE active = 1
        AND category IS NOT NULL
        AND category != ''
        GROUP BY category
        ORDER BY count DESC
    """)

    categories = []

    for row in rows:

        categories.append({
            "name": row["category"],
            "count": row["count"]
        })

    return json_response({
        "ok": True,
        "categories": categories
    })


# ============================================================
# API: VACANCIES
# ============================================================

async def api_vacancies(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    search = request.query.get(
        "search",
        ""
    ).strip()

    category = request.query.get(
        "category",
        ""
    ).strip()

    city = request.query.get(
        "city",
        ""
    ).strip()

    query = """
        SELECT *
        FROM vacancies
        WHERE active = 1
    """

    params = []

    if search:

        value = f"%{search}%"

        query += """
            AND (
                title LIKE ?
                OR category LIKE ?
                OR salary LIKE ?
                OR description LIKE ?
                OR requirements LIKE ?
            )
        """

        params.extend([
            value,
            value,
            value,
            value,
            value
        ])

    if category:

        query += """
            AND category = ?
        """

        params.append(category)

    if city:

        value = f"%{city}%"

        query += """
            AND (
                title LIKE ?
                OR description LIKE ?
                OR requirements LIKE ?
            )
        """

        params.extend([
            value,
            value,
            value
        ])

    query += """
        ORDER BY id DESC
        LIMIT 100
    """

    rows = db_fetchall(
        query,
        params
    )

    result = []

    for row in rows:

        item = row_to_dict(row)

        favorite = db_fetchone(
            """
            SELECT id
            FROM favorites
            WHERE user_id = ?
            AND vacancy_id = ?
            """,
            (
                user["id"],
                row["id"]
            )
        )

        item["favorite"] = bool(
            favorite
        )

        result.append(item)

    return json_response({
        "ok": True,
        "vacancies": result
    })


# ============================================================
# API: SINGLE VACANCY
# ============================================================

async def api_vacancy(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    try:

        vacancy_id = int(
            request.match_info[
                "vacancy_id"
            ]
        )

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Invalid vacancy ID"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT *
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Вакансия не найдена"
            },
            404
        )

    favorite = db_fetchone(
        """
        SELECT id
        FROM favorites
        WHERE user_id = ?
        AND vacancy_id = ?
        """,
        (
            user["id"],
            vacancy_id
        )
    )

    item = row_to_dict(
        vacancy
    )

    item["favorite"] = bool(
        favorite
    )

    return json_response({
        "ok": True,
        "vacancy": item
    })


# ============================================================
# API: FAVORITES
# ============================================================

async def api_favorites(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    rows = db_fetchall("""
        SELECT vacancies.*
        FROM vacancies
        INNER JOIN favorites
            ON favorites.vacancy_id = vacancies.id
        WHERE favorites.user_id = ?
        AND vacancies.active = 1
        ORDER BY favorites.id DESC
    """, (
        user["id"],
    ))

    result = []

    for row in rows:

        item = row_to_dict(row)

        item["favorite"] = True

        result.append(item)

    return json_response({
        "ok": True,
        "vacancies": result
    })


async def api_favorite_toggle(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    try:

        data = await request.json()

        vacancy_id = int(
            data.get("vacancy_id")
        )

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Некорректные данные"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT id
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Вакансия не найдена"
            },
            404
        )

    favorite = db_fetchone(
        """
        SELECT id
        FROM favorites
        WHERE user_id = ?
        AND vacancy_id = ?
        """,
        (
            user["id"],
            vacancy_id
        )
    )

    if favorite:

        db_execute(
            """
            DELETE FROM favorites
            WHERE user_id = ?
            AND vacancy_id = ?
            """,
            (
                user["id"],
                vacancy_id
            )
        )

        is_favorite = False

    else:

        db_execute(
            """
            INSERT OR IGNORE INTO favorites (
                user_id,
                vacancy_id,
                created_at
            )
            VALUES (?, ?, ?)
            """,
            (
                user["id"],
                vacancy_id,
                datetime.now().isoformat()
            )
        )

        is_favorite = True

    return json_response({
        "ok": True,
        "favorite": is_favorite
    })


# ============================================================
# API: APPLY
# ============================================================

async def api_apply(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    try:

        data = await request.json()

        vacancy_id = int(
            data.get("vacancy_id")
        )

        age = int(
            data.get("age")
        )

        city = str(
            data.get("city", "")
        ).strip()

        contact = str(
            data.get("contact", "")
        ).strip()

        message = str(
            data.get("message", "")
        ).strip()

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Некорректные данные"
            },
            400
        )

    if not MIN_AGE <= age <= MAX_AGE:

        return json_response(
            {
                "ok": False,
                "error": (
                    f"Возраст должен быть "
                    f"от {MIN_AGE} до {MAX_AGE}"
                )
            },
            400
        )

    if len(city) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Укажите город"
            },
            400
        )

    if len(contact) < 3:

        return json_response(
            {
                "ok": False,
                "error": "Укажите контакт"
            },
            400
        )

    if len(message) < 5:

        return json_response(
            {
                "ok": False,
                "error": "Расскажите немного о себе"
            },
            400
        )

    if len(message) > 1000:

        return json_response(
            {
                "ok": False,
                "error": "Сообщение слишком длинное"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT *
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Вакансия недоступна"
            },
            404
        )

    db_user = get_user(
        user["id"]
    )

    db_execute("""
        INSERT INTO applications (
            vacancy_id,
            user_id,
            name,
            age,
            city,
            contact,
            message,
            created_at,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
    """, (
        vacancy_id,
        user["id"],
        db_user["first_name"] or user.get("first_name") or "—",
        age,
        city,
        contact,
        message,
        datetime.now().isoformat()
    ))

    application_id = db.execute(
        "SELECT last_insert_rowid()"
    ).fetchone()[0]

    admin_text = (
        "📩 <b>НОВЫЙ ОТКЛИК</b>\n\n"
        f"🆔 Отклик: <code>{application_id}</code>\n"
        f"💼 Вакансия: <b>{vacancy['title']}</b>\n\n"
        f"👤 Имя: "
        f"{db_user['first_name'] or '—'}\n"
        f"🎂 Возраст: {age}\n"
        f"🏙️ Город: {city}\n"
        f"📞 Контакт: {contact}\n\n"
        f"📝 О себе:\n{message}\n\n"
        f"🆔 Telegram ID: "
        f"<code>{user['id']}</code>"
    )

    for admin_id in ADMIN_IDS:

        try:

            await bot.send_message(
                admin_id,
                admin_text
            )

        except Exception as error:

            logger.error(
                "Ошибка отправки админу: %s",
                error
            )

    return json_response({
        "ok": True,
        "application_id": application_id
    })


# ============================================================
# API: MY APPLICATIONS
# ============================================================

async def api_my_applications(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    rows = db_fetchall("""
        SELECT
            applications.*,
            vacancies.title
        FROM applications
        LEFT JOIN vacancies
            ON vacancies.id = applications.vacancy_id
        WHERE applications.user_id = ?
        ORDER BY applications.id DESC
    """, (
        user["id"],
    ))

    return json_response({
        "ok": True,
        "applications": rows_to_list(rows)
    })


# ============================================================
# API: PROFILE
# ============================================================

async def api_profile_update(request):

    user = await get_miniapp_user(request)

    if not user:

        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    try:

        data = await request.json()

        first_name = str(
            data.get("first_name", "")
        ).strip()

        city = str(
            data.get("city", "")
        ).strip()

        age = int(
            data.get("age")
        )

        username = str(
            data.get("username", "")
        ).strip()

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Некорректные данные"
            },
            400
        )

    if len(first_name) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Укажите имя"
            },
            400
        )

    if len(city) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Укажите город"
            },
            400
        )

    if not MIN_AGE <= age <= MAX_AGE:

        return json_response(
            {
                "ok": False,
                "error": "Некорректный возраст"
            },
            400
        )

    update_user(
        user["id"],
        first_name=first_name,
        city=city,
        age=age,
        username=username.lstrip("@")
    )

    return json_response({
        "ok": True,
        "user": row_to_dict(
            get_user(user["id"])
        )
    })


# ============================================================
# ADMIN AUTH
# ============================================================

async def admin_check(request):

    user = await get_miniapp_user(request)

    if not user:

        return None, json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    if not is_admin(user["id"]):

        return None, json_response(
            {
                "ok": False,
                "error": "Нет доступа"
            },
            403
        )

    return user, None


# ============================================================
# ADMIN: STATS
# ============================================================

async def api_admin_stats(request):

    user, error = await admin_check(request)

    if error:
        return error

    users = db_fetchone(
        "SELECT COUNT(*) AS c FROM users"
    )["c"]

    vacancies = db_fetchone(
        """
        SELECT COUNT(*) AS c
        FROM vacancies
        WHERE active = 1
        """
    )["c"]

    applications = db_fetchone(
        """
        SELECT COUNT(*) AS c
        FROM applications
        """
    )["c"]

    return json_response({
        "ok": True,
        "stats": {
            "users": users,
            "vacancies": vacancies,
            "applications": applications
        }
    })


# ============================================================
# ADMIN: VACANCIES
# ============================================================

async def api_admin_vacancies(request):

    user, error = await admin_check(request)

    if error:
        return error

    rows = db_fetchall("""
        SELECT *
        FROM vacancies
        ORDER BY id DESC
    """)

    return json_response({
        "ok": True,
        "vacancies": rows_to_list(rows)
    })


async def api_admin_create_vacancy(request):

    user, error = await admin_check(request)

    if error:
        return error

    try:

        data = await request.json()

        title = str(
            data.get("title", "")
        ).strip()

        category = str(
            data.get("category", "")
        ).strip()

        salary = str(
            data.get("salary", "")
        ).strip()

        description = str(
            data.get("description", "")
        ).strip()

        requirements = str(
            data.get("requirements", "")
        ).strip()

        contact = str(
            data.get("contact", "")
        ).strip()

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Некорректные данные"
            },
            400
        )

    if len(title) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Введите название вакансии"
            },
            400
        )

    db_execute("""
        INSERT INTO vacancies (
            title,
            category,
            salary,
            description,
            requirements,
            contact,
            employer_id,
            created_at,
            active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, (
        title,
        category,
        salary,
        description,
        requirements,
        contact,
        user["id"],
        datetime.now().isoformat()
    ))

    vacancy_id = db.execute(
        "SELECT last_insert_rowid()"
    ).fetchone()[0]

    return json_response({
        "ok": True,
        "vacancy_id": vacancy_id
    })


async def api_admin_toggle_vacancy(request):

    user, error = await admin_check(request)

    if error:
        return error

    try:

        vacancy_id = int(
            request.match_info[
                "vacancy_id"
            ]
        )

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Invalid ID"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT active
        FROM vacancies
        WHERE id = ?
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Вакансия не найдена"
            },
            404
        )

    new_status = (
        0
        if vacancy["active"]
        else 1
    )

    db_execute(
        """
        UPDATE vacancies
        SET active = ?
        WHERE id = ?
        """,
        (
            new_status,
            vacancy_id
        )
    )

    return json_response({
        "ok": True,
        "active": bool(new_status)
    })


async def api_admin_delete_vacancy(request):

    user, error = await admin_check(request)

    if error:
        return error

    try:

        vacancy_id = int(
            request.match_info[
                "vacancy_id"
            ]
        )

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Invalid ID"
            },
            400
        )

    db_execute(
        """
        DELETE FROM vacancies
        WHERE id = ?
        """,
        (vacancy_id,)
    )

    return json_response({
        "ok": True
    })


# ============================================================
# ADMIN: APPLICATIONS
# ============================================================

async def api_admin_applications(request):

    user, error = await admin_check(request)

    if error:
        return error

    rows = db_fetchall("""
        SELECT
            applications.*,
            vacancies.title
        FROM applications
        LEFT JOIN vacancies
            ON vacancies.id = applications.vacancy_id
        ORDER BY applications.id DESC
        LIMIT 100
    """)

    return json_response({
        "ok": True,
        "applications": rows_to_list(rows)
    })


# ============================================================
# HEALTH
# ============================================================

async def health(request):

    return json_response({
        "ok": True,
        "service": "work-bot",
        "mini_app": MINI_APP_URL
    })


# ============================================================
# STATIC WEB
# ============================================================

async def index_page(request):

    index_file = WEB_DIR / "index.html"

    if not index_file.exists():

        return web.Response(
            text=(
                "ERROR: web/index.html не найден.\n"
                f"Искали: {index_file}"
            ),
            status=500,
            content_type="text/plain"
        )

    return web.FileResponse(
        index_file
    )


async def web_app_js(request):

    file = WEB_DIR / "app.js"

    if not file.exists():

        return web.Response(
            text="app.js не найден",
            status=404
        )

    return web.FileResponse(file)


async def web_style_css(request):

    file = WEB_DIR / "style.css"

    if not file.exists():

        return web.Response(
            text="style.css не найден",
            status=404
        )

    return web.FileResponse(file)


# ============================================================
# WEB SERVER
# ============================================================

def create_web_app():

    app = web.Application()

    # --------------------------------------------------------
    # HEALTH
    # --------------------------------------------------------

    app.router.add_get(
        "/health",
        health
    )

    # --------------------------------------------------------
    # MINI APP
    # --------------------------------------------------------

    app.router.add_get(
        "/",
        index_page
    )

    app.router.add_get(
        "/index.html",
        index_page
    )

    app.router.add_get(
        "/app.js",
        web_app_js
    )

    app.router.add_get(
        "/style.css",
        web_style_css
    )

    # --------------------------------------------------------
    # API
    # --------------------------------------------------------

    app.router.add_get(
        "/api/me",
        api_me
    )

    app.router.add_get(
        "/api/vacancies",
        api_vacancies
    )

    app.router.add_get(
        "/api/vacancy/{vacancy_id}",
        api_vacancy
    )

    app.router.add_get(
        "/api/categories",
        api_categories
    )

    app.router.add_get(
        "/api/favorites",
        api_favorites
    )

    app.router.add_post(
        "/api/favorite",
        api_favorite_toggle
    )

    app.router.add_post(
        "/api/apply",
        api_apply
    )

    app.router.add_get(
        "/api/my-applications",
        api_my_applications
    )

    app.router.add_post(
        "/api/profile",
        api_profile_update
    )

    # --------------------------------------------------------
    # ADMIN API
    # --------------------------------------------------------

    app.router.add_get(
        "/api/admin/stats",
        api_admin_stats
    )

    app.router.add_get(
        "/api/admin/vacancies",
        api_admin_vacancies
    )

    app.router.add_post(
        "/api/admin/vacancy",
        api_admin_create_vacancy
    )

    app.router.add_post(
        "/api/admin/vacancy/{vacancy_id}/toggle",
        api_admin_toggle_vacancy
    )

    app.router.add_delete(
        "/api/admin/vacancy/{vacancy_id}",
        api_admin_delete_vacancy
    )

    app.router.add_get(
        "/api/admin/applications",
        api_admin_applications
    )

    return app


async def start_web_server():

    app = create_web_app()

    runner = web.AppRunner(
        app
    )

    await runner.setup()

    site = web.TCPSite(
        runner,
        HOST,
        PORT
    )

    await site.start()

    logger.info(
        "=========================================="
    )

    logger.info(
        "WEB SERVER STARTED"
    )

    logger.info(
        "PORT: %s",
        PORT
    )

    logger.info(
        "WEB DIR: %s",
        WEB_DIR
    )

    logger.info(
        "MINI APP: %s",
        MINI_APP_URL
    )

    logger.info(
        "=========================================="
    )

    return runner


# ============================================================
# TELEGRAM /START
# ============================================================

@dp.message(CommandStart())
async def start_handler(message: Message):

    tg_user = message.from_user

    create_user_from_telegram(
        tg_user.id,
        tg_user.username,
        tg_user.first_name,
        tg_user.last_name
    )

    builder = InlineKeyboardBuilder()

    builder.button(
        text="🚀 Открыть приложение",
        web_app=WebAppInfo(
            url=MINI_APP_URL
        )
    )

    builder.button(
        text="📋 Вакансии",
        callback_data="vacancies"
    )

    if is_admin(
        tg_user.id
    ):

        builder.button(
            text="⚙️ Админ-панель",
            callback_data="admin"
        )

    builder.adjust(1)

    await message.answer(
        "👋 <b>Добро пожаловать!</b>\n\n"
        "💼 Здесь можно искать работу, "
        "смотреть вакансии и отправлять отклики.\n\n"
        "Нажмите кнопку ниже, чтобы открыть "
        "приложение:",
        reply_markup=builder.as_markup()
    )


# ============================================================
# TELEGRAM VACANCIES
# ============================================================

@dp.callback_query(
    F.data == "vacancies"
)
async def vacancies_callback(
    callback: CallbackQuery
):

    rows = db_fetchall("""
        SELECT *
        FROM vacancies
        WHERE active = 1
        ORDER BY id DESC
        LIMIT 50
    """)

    if not rows:

        await callback.message.answer(
            "📭 Сейчас вакансий нет."
        )

        await callback.answer()

        return

    builder = InlineKeyboardBuilder()

    for vacancy in rows:

        title = (
            vacancy["title"]
            or "Вакансия"
        )

        builder.button(
            text=f"💼 {title[:45]}",
            callback_data=(
                f"vacancy:{vacancy['id']}"
            )
        )

    builder.adjust(1)

    await callback.message.answer(
        "📋 <b>Последние вакансии:</b>",
        reply_markup=builder.as_markup()
    )

    await callback.answer()


@dp.callback_query(
    F.data.startswith("vacancy:")
)
async def vacancy_callback(
    callback: CallbackQuery
):

    try:

        vacancy_id = int(
            callback.data.split(":")[1]
        )

    except Exception:

        await callback.answer(
            "Ошибка.",
            show_alert=True
        )

        return

    vacancy = db_fetchone(
        """
        SELECT *
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        await callback.answer(
            "Вакансия не найдена.",
            show_alert=True
        )

        return

    text = (
        f"💼 <b>{vacancy['title']}</b>\n\n"
        f"📂 <b>Категория:</b> "
        f"{vacancy['category'] or '—'}\n"
        f"💰 <b>Зарплата:</b> "
        f"{vacancy['salary'] or '—'}\n\n"
        f"📝 <b>Описание:</b>\n"
        f"{vacancy['description'] or '—'}\n\n"
        f"📌 <b>Требования:</b>\n"
        f"{vacancy['requirements'] or '—'}"
    )

    await callback.message.answer(
        text
    )

    await callback.answer()


# ============================================================
# TELEGRAM ADMIN
# ============================================================

@dp.callback_query(
    F.data == "admin"
)
async def admin_callback(
    callback: CallbackQuery
):

    if not is_admin(
        callback.from_user.id
    ):

        await callback.answer(
            "Нет доступа.",
            show_alert=True
        )

        return

    await callback.message.answer(
        "⚙️ <b>Админ-панель</b>\n\n"
        "Откройте Mini App для полного "
        "управления вакансиями и откликами."
    )

    await callback.answer()


# ============================================================
# TELEGRAM MENU BUTTON
# ============================================================

async def configure_bot():

    try:

        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="💼 Работа",
                web_app=WebAppInfo(
                    url=MINI_APP_URL
                )
            )
        )

        logger.info(
            "Telegram menu button configured."
        )

    except Exception as error:

        logger.error(
            "Menu button error: %s",
            error
        )


# ============================================================
# MAIN
# ============================================================

async def main():

    logger.info(
        "=========================================="
    )

    logger.info(
        "STARTING WORK BOT"
    )

    logger.info(
        "MINI APP URL: %s",
        MINI_APP_URL
    )

    logger.info(
        "WEB DIR: %s",
        WEB_DIR
    )

    logger.info(
        "DATABASE: %s",
        DB_NAME
    )

    logger.info(
        "ADMINS: %s",
        ADMIN_IDS
    )

    logger.info(
        "=========================================="
    )

    # Удаляем webhook перед polling.
    await bot.delete_webhook(
        drop_pending_updates=True
    )

    await configure_bot()

    web_runner = await start_web_server()

    try:

        await dp.start_polling(
            bot
        )

    finally:

        await web_runner.cleanup()

        await bot.session.close()

        db.close()


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    try:

        asyncio.run(
            main()
        )

    except KeyboardInterrupt:

        logger.info(
            "Бот остановлен."
        )

    except Exception as error:

        logger.exception(
            "КРИТИЧЕСКАЯ ОШИБКА: %s",
            error
        )
