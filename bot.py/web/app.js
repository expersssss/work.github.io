// ============================================================
// TELEGRAM MINI APP — РАБОТА
// Совместимо с API из boti.py
// ============================================================

const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();

    if (tg.enableClosingConfirmation) {
        tg.enableClosingConfirmation();
    }
}

// ============================================================
// STATE
// ============================================================

const state = {
    user: null,
    isAdmin: false,

    vacancies: [],
    categories: [],
    favorites: [],
    applications: [],

    currentCategory: "",
    search: "",

    currentVacancy: null,
    currentPage: "home"
};


// ============================================================
// HELPERS
// ============================================================

function $(id) {
    return document.getElementById(id);
}


function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function showToast(text) {
    if (tg && tg.showAlert) {
        tg.showAlert(text);
        return;
    }

    alert(text);
}


function showConfirm(text) {
    return new Promise(resolve => {
        if (tg && tg.showConfirm) {
            tg.showConfirm(text, resolve);
        } else {
            resolve(confirm(text));
        }
    });
}


function formatDate(value) {
    if (!value) return "";

    try {
        const date = new Date(value);

        if (isNaN(date.getTime())) {
            return "";
        }

        return date.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
    } catch {
        return "";
    }
}


function getInitials(user) {
    const name = user?.first_name || "П";

    return name
        .trim()
        .charAt(0)
        .toUpperCase();
}


function getApiHeaders() {
    const headers = {
        "Content-Type": "application/json"
    };

    if (tg?.initData) {
        headers["X-Telegram-Init-Data"] = tg.initData;
    }

    return headers;
}


async function api(url, options = {}) {
    const config = {
        ...options,
        headers: {
            ...getApiHeaders(),
            ...(options.headers || {})
        }
    };

    const response = await fetch(url, config);

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("Сервер вернул неправильный ответ");
    }

    if (!response.ok || data.ok === false) {
        throw new Error(
            data.error || `Ошибка сервера: ${response.status}`
        );
    }

    return data;
}


// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

    setupSearch();

    await loadApp();

});


async function loadApp() {

    try {

        const me = await api("/api/me");

        state.user = me.user;
        state.isAdmin = !!me.is_admin;

        updateHello();
        renderAdminButton();

        await Promise.all([
            loadCategories(),
            loadVacancies()
        ]);

    } catch (error) {

        console.error(error);

        renderAuthError(error.message);

    }

}


// ============================================================
// USER
// ============================================================

function updateHello() {

    const hello = $("hello");

    if (!hello) return;

    const name = state.user?.first_name;

    if (name) {
        hello.textContent = `Привет, ${name}! 👋`;
    } else {
        hello.textContent = "Найдём работу для вас";
    }
}


function renderAuthError(message) {

    const content = $("content");

    if (!content) return;

    content.innerHTML = `
        <div class="error-card">
            <div class="error-icon">⚠️</div>

            <h3>Не удалось загрузить приложение</h3>

            <p>${escapeHtml(message)}</p>

            <button class="primary-button" onclick="loadApp()">
                Повторить
            </button>
        </div>
    `;
}


// ============================================================
// SEARCH
// ============================================================

function setupSearch() {

    const input = $("searchInput");

    if (!input) return;

    let timeout;

    input.addEventListener("input", () => {

        state.search = input.value.trim();

        clearTimeout(timeout);

        timeout = setTimeout(() => {
            loadVacancies();
        }, 350);

    });
}


function clearSearch() {

    const input = $("searchInput");

    if (input) {
        input.value = "";
    }

    state.search = "";

    loadVacancies();
}


// ============================================================
// CATEGORIES
// ============================================================

async function loadCategories() {

    try {

        const data = await api("/api/categories");

        state.categories = data.categories || [];

        renderCategories();

    } catch (error) {

        console.error("Categories:", error);

    }
}


function renderCategories() {

    const container = $("categories");

    if (!container) return;

    let html = `
        <button
            class="category ${state.currentCategory === "" ? "active" : ""}"
            onclick="selectCategory('')"
        >
            Все
        </button>
    `;

    state.categories.forEach(category => {

        const name = category.name;

        html += `
            <button
                class="category ${state.currentCategory === name ? "active" : ""}"
                onclick="selectCategory(${JSON.stringify(name)})"
            >
                ${escapeHtml(name)}
                <span class="category-count">
                    ${category.count}
                </span>
            </button>
        `;

    });

    container.innerHTML = html;
}


function selectCategory(category) {

    state.currentCategory = category;

    renderCategories();

    loadVacancies();
}


// ============================================================
// VACANCIES
// ============================================================

async function loadVacancies() {

    const content = $("content");

    if (!content) return;

    content.innerHTML = `
        <div class="loading-screen">
            <div class="spinner"></div>
            <div>Загружаем вакансии...</div>
        </div>
    `;

    try {

        const params = new URLSearchParams();

        if (state.search) {
            params.set("search", state.search);
        }

        if (state.currentCategory) {
            params.set(
                "category",
                state.currentCategory
            );
        }

        const url =
            "/api/vacancies" +
            (params.toString()
                ? "?" + params.toString()
                : "");

        const data = await api(url);

        state.vacancies = data.vacancies || [];

        renderVacancies();

    } catch (error) {

        console.error(error);

        content.innerHTML = `
            <div class="error-card">
                <div class="error-icon">⚠️</div>
                <h3>Ошибка загрузки</h3>
                <p>${escapeHtml(error.message)}</p>

                <button
                    class="primary-button"
                    onclick="loadVacancies()"
                >
                    Повторить
                </button>
            </div>
        `;

    }

}


function renderVacancies() {

    const content = $("content");

    if (!content) return;

    if (!state.vacancies.length) {

        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔎</div>

                <h3>Вакансий не найдено</h3>

                <p>
                    Попробуйте изменить запрос
                    или выбрать другую категорию.
                </p>

                <button
                    class="secondary-button"
                    onclick="clearSearch(); selectCategory('')"
                >
                    Сбросить фильтры
                </button>
            </div>
        `;

        return;
    }

    let html = `
        <div class="results-header">
            <div>
                <div class="results-title">
                    Вакансии
                </div>

                <div class="results-count">
                    Найдено: ${state.vacancies.length}
                </div>
            </div>
        </div>

        <div class="vacancy-list">
    `;

    state.vacancies.forEach(vacancy => {
        html += vacancyCard(vacancy);
    });

    html += "</div>";

    content.innerHTML = html;
}


function vacancyCard(vacancy) {

    const favorite = !!vacancy.favorite;

    const category =
        vacancy.category ||
        "Работа";

    const salary =
        vacancy.salary ||
        "Зарплата не указана";

    const description =
        vacancy.description ||
        "Описание вакансии отсутствует.";

    const shortDescription =
        description.length > 130
            ? description.substring(0, 130) + "..."
            : description;

    return `
        <article
            class="vacancy-card"
            onclick="openVacancy(${vacancy.id})"
        >

            <div class="vacancy-top">

                <div class="vacancy-icon">
                    ${getCategoryIcon(category)}
                </div>

                <button
                    class="favorite-button ${favorite ? "active" : ""}"
                    onclick="event.stopPropagation(); toggleFavorite(${vacancy.id})"
                    aria-label="Избранное"
                >
                    ${favorite ? "♥" : "♡"}
                </button>

            </div>

            <div class="vacancy-category">
                ${escapeHtml(category)}
            </div>

            <h3 class="vacancy-title">
                ${escapeHtml(vacancy.title)}
            </h3>

            <div class="vacancy-salary">
                💰 ${escapeHtml(salary)}
            </div>

            <p class="vacancy-description">
                ${escapeHtml(shortDescription)}
            </p>

            <div class="vacancy-footer">

                <span>
                    ${formatDate(vacancy.created_at)}
                </span>

                <span class="view-link">
                    Подробнее →
                </span>

            </div>

        </article>
    `;
}


function getCategoryIcon(category) {

    const text = String(category).toLowerCase();

    if (text.includes("водител")) return "🚗";
    if (text.includes("курьер")) return "🛵";
    if (text.includes("логист")) return "📦";
    if (text.includes("спорт")) return "🏆";
    if (text.includes("стро")) return "🏗️";
    if (text.includes("продаж")) return "💼";
    if (text.includes("офис")) return "💻";
    if (text.includes("достав")) return "📦";
    if (text.includes("повар")) return "👨‍🍳";
    if (text.includes("охран")) return "🛡️";

    return "💼";
}


// ============================================================
// VACANCY DETAILS
// ============================================================

async function openVacancy(id) {

    try {

        const data = await api(
            `/api/vacancy/${id}`
        );

        state.currentVacancy = data.vacancy;

        renderVacancyModal(
            data.vacancy
        );

    } catch (error) {

        showToast(error.message);

    }

}


function renderVacancyModal(vacancy) {

    const modal = $("vacancyModal");
    const content = $("vacancyContent");

    if (!modal || !content) return;

    const favorite = !!vacancy.favorite;

    content.innerHTML = `
        <div class="detail-icon">
            ${getCategoryIcon(vacancy.category)}
        </div>

        <div class="detail-category">
            ${escapeHtml(
                vacancy.category || "Работа"
            )}
        </div>

        <h2 class="detail-title">
            ${escapeHtml(vacancy.title)}
        </h2>

        <div class="detail-salary">
            💰 ${escapeHtml(
                vacancy.salary ||
                "Зарплата не указана"
            )}
        </div>

        <div class="detail-section">
            <div class="detail-label">
                📝 Описание
            </div>

            <div class="detail-text">
                ${escapeHtml(
                    vacancy.description ||
                    "Не указано"
                ).replace(/\n/g, "<br>")}
            </div>
        </div>

        <div class="detail-section">
            <div class="detail-label">
                📌 Требования
            </div>

            <div class="detail-text">
                ${escapeHtml(
                    vacancy.requirements ||
                    "Не указаны"
                ).replace(/\n/g, "<br>")}
            </div>
        </div>

        <div class="detail-date">
            Опубликовано:
            ${formatDate(vacancy.created_at)}
        </div>

        <div class="detail-actions">

            <button
                class="secondary-button"
                onclick="toggleFavorite(${vacancy.id})"
            >
                ${favorite ? "♥ В избранном" : "♡ В избранное"}
            </button>

            <button
                class="primary-button"
                onclick="openApplication(${vacancy.id})"
            >
                📩 Откликнуться
            </button>

        </div>
    `;

    modal.classList.remove("hidden");
}


function closeModal() {

    const modal = $("vacancyModal");

    if (modal) {
        modal.classList.add("hidden");
    }
}


// ============================================================
// FAVORITES
// ============================================================

async function toggleFavorite(vacancyId) {

    try {

        const data = await api(
            "/api/favorite",
            {
                method: "POST",

                body: JSON.stringify({
                    vacancy_id: vacancyId
                })
            }
        );

        const favorite = !!data.favorite;

        state.vacancies.forEach(vacancy => {

            if (vacancy.id === vacancyId) {
                vacancy.favorite = favorite;
            }

        });

        if (
            state.currentVacancy &&
            state.currentVacancy.id === vacancyId
        ) {
            state.currentVacancy.favorite = favorite;

            renderVacancyModal(
                state.currentVacancy
            );
        }

        if (state.currentPage === "favorites") {
            await showFavorites();
        } else {
            renderVacancies();
        }

    } catch (error) {

        showToast(error.message);

    }

}


async function showFavorites() {

    setActiveNav("favorites");

    state.currentPage = "favorites";

    const content = $("content");

    if (!content) return;

    content.innerHTML = `
        <div class="loading-screen">
            <div class="spinner"></div>
            <div>Загружаем избранное...</div>
        </div>
    `;

    try {

        const data = await api(
            "/api/favorites"
        );

        state.favorites = data.vacancies || [];

        if (!state.favorites.length) {

            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❤️</div>

                    <h3>Избранное пусто</h3>

                    <p>
                        Добавляйте интересные вакансии
                        в избранное.
                    </p>

                    <button
                        class="primary-button"
                        onclick="showHome()"
                    >
                        Смотреть вакансии
                    </button>
                </div>
            `;

            return;
        }

        content.innerHTML = `
            <div class="page-heading">
                <div class="page-title">
                    ❤️ Избранное
                </div>

                <div class="page-subtitle">
                    ${state.favorites.length} вакансий
                </div>
            </div>

            <div class="vacancy-list">
                ${state.favorites
                    .map(vacancy => vacancyCard(vacancy))
                    .join("")
                }
            </div>
        `;

    } catch (error) {

        content.innerHTML = `
            <div class="error-card">
                <div class="error-icon">⚠️</div>
                <h3>Ошибка</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>
        `;

    }

}


// ============================================================
// APPLICATIONS
// ============================================================

async function showApplications() {

    setActiveNav("applications");

    state.currentPage = "applications";

    const content = $("content");

    if (!content) return;

    content.innerHTML = `
        <div class="loading-screen">
            <div class="spinner"></div>
            <div>Загружаем отклики...</div>
        </div>
    `;

    try {

        const data = await api(
            "/api/my-applications"
        );

        state.applications =
            data.applications || [];

        renderApplications();

    } catch (error) {

        content.innerHTML = `
            <div class="error-card">
                <div class="error-icon">⚠️</div>
                <h3>Ошибка</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>
        `;

    }

}


function renderApplications() {

    const content = $("content");

    if (!content) return;

    if (!state.applications.length) {

        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📩</div>

                <h3>Откликов пока нет</h3>

                <p>
                    Откликнитесь на вакансию,
                    чтобы она появилась здесь.
                </p>

                <button
                    class="primary-button"
                    onclick="showHome()"
                >
                    Найти работу
                </button>
            </div>
        `;

        return;
    }

    let html = `
        <div class="page-heading">
            <div class="page-title">
                📩 Мои отклики
            </div>

            <div class="page-subtitle">
                ${state.applications.length}
            </div>
        </div>

        <div class="application-list">
    `;

    state.applications.forEach(application => {

        const status =
            application.status || "new";

        html += `
            <div class="application-card">

                <div class="application-icon">
                    📩
                </div>

                <div class="application-main">

                    <h3>
                        ${escapeHtml(
                            application.title ||
                            "Вакансия"
                        )}
                    </h3>

                    <div class="application-city">
                        📍 ${escapeHtml(
                            application.city || "—"
                        )}
                    </div>

                    <div class="application-date">
                        ${formatDate(
                            application.created_at
                        )}
                    </div>

                </div>

                <div class="status-badge status-${escapeHtml(status)}">
                    ${getStatusName(status)}
                </div>

            </div>
        `;

    });

    html += "</div>";

    content.innerHTML = html;
}


function getStatusName(status) {

    switch (status) {

        case "new":
            return "Новый";

        case "accepted":
            return "Принят";

        case "rejected":
            return "Отклонён";

        case "review":
            return "На рассмотрении";

        default:
            return status;

    }

}


// ============================================================
// APPLICATION MODAL
// ============================================================

function openApplication(vacancyId) {

    state.currentVacancy = {
        ...(state.currentVacancy || {}),
        id: vacancyId
    };

    const modal = $("applicationModal");

    if (!modal) return;

    modal.classList.remove("hidden");

}


function closeApplication() {

    const modal = $("applicationModal");

    if (modal) {
        modal.classList.add("hidden");
    }

}


async function sendApplication() {

    const vacancyId =
        state.currentVacancy?.id;

    if (!vacancyId) {
        showToast("Вакансия не выбрана");
        return;
    }

    const age =
        Number($("applyAge")?.value);

    const city =
        $("applyCity")?.value.trim();

    const contact =
        $("applyContact")?.value.trim();

    const message =
        $("applyMessage")?.value.trim();

    if (!age) {
        showToast("Укажите возраст");
        return;
    }

    if (!city) {
        showToast("Укажите город");
        return;
    }

    if (!contact) {
        showToast("Укажите контакт");
        return;
    }

    if (!message) {
        showToast("Расскажите немного о себе");
        return;
    }

    try {

        const button =
            document.querySelector(
                "#applicationModal .primary-button"
            );

        if (button) {
            button.disabled = true;
            button.textContent = "Отправляем...";
        }

        const data = await api(
            "/api/apply",
            {
                method: "POST",

                body: JSON.stringify({
                    vacancy_id: vacancyId,
                    age,
                    city,
                    contact,
                    message
                })
            }
        );

        closeApplication();

        if ($("applyAge")) $("applyAge").value = "";
        if ($("applyCity")) $("applyCity").value = "";
        if ($("applyContact")) $("applyContact").value = "";
        if ($("applyMessage")) $("applyMessage").value = "";

        showToast(
            `Отклик отправлен! №${data.application_id}`
        );

    } catch (error) {

        showToast(error.message);

    } finally {

        const button =
            document.querySelector(
                "#applicationModal .primary-button"
            );

        if (button) {
            button.disabled = false;
            button.textContent =
                "📩 Отправить отклик";
        }

    }

}


// ============================================================
// PROFILE
// ============================================================

async function openProfile() {

    setActiveNav("profile");

    const modal = $("profileModal");
    const content = $("profileContent");

    if (!modal || !content) return;

    const user = state.user || {};

    content.innerHTML = `
        <div class="profile-header">

            <div class="profile-avatar">
                ${getInitials(user)}
            </div>

            <div>
                <div class="profile-name">
                    ${escapeHtml(
                        user.first_name || "Пользователь"
                    )}
                </div>

                <div class="profile-username">
                    ${
                        user.username
                            ? "@" + escapeHtml(user.username)
                            : "Telegram"
                    }
                </div>
            </div>

        </div>

        <div class="profile-form">

            <div class="form-group">
                <label>Имя</label>

                <input
                    id="profileName"
                    type="text"
                    value="${escapeHtml(
                        user.first_name || ""
                    )}"
                    placeholder="Ваше имя"
                >
            </div>

            <div class="form-group">
                <label>Город</label>

                <input
                    id="profileCity"
                    type="text"
                    value="${escapeHtml(
                        user.city || ""
                    )}"
                    placeholder="Ваш город"
                >
            </div>

            <div class="form-group">
                <label>Возраст</label>

                <input
                    id="profileAge"
                    type="number"
                    min="14"
                    max="50"
                    value="${user.age || ""}"
                    placeholder="Ваш возраст"
                >
            </div>

            <div class="form-group">
                <label>Username</label>

                <input
                    id="profileUsername"
                    type="text"
                    value="${
                        user.username
                            ? "@" + escapeHtml(user.username)
                            : ""
                    }"
                    placeholder="@username"
                >
            </div>

            <button
                class="primary-button"
                onclick="saveProfile()"
            >
                💾 Сохранить профиль
            </button>

            ${
                state.isAdmin
                    ? `
                        <button
                            class="admin-button"
                            onclick="closeProfile(); openAdmin()"
                        >
                            ⚙️ Админ-панель
                        </button>
                    `
                    : ""
            }

        </div>
    `;

    modal.classList.remove("hidden");

}


function closeProfile() {

    const modal = $("profileModal");

    if (modal) {
        modal.classList.add("hidden");
    }

}


async function saveProfile() {

    const first_name =
        $("profileName")?.value.trim();

    const city =
        $("profileCity")?.value.trim();

    const age =
        Number($("profileAge")?.value);

    const username =
        $("profileUsername")?.value.trim();

    try {

        const data = await api(
            "/api/profile",
            {
                method: "POST",

                body: JSON.stringify({
                    first_name,
                    city,
                    age,
                    username
                })
            }
        );

        state.user = data.user;

        updateHello();

        showToast("Профиль сохранён");

        closeProfile();

    } catch (error) {

        showToast(error.message);

    }

}


// ============================================================
// NAVIGATION
// ============================================================

function showHome() {

    state.currentPage = "home";

    setActiveNav("home");

    loadVacancies();

}


function setActiveNav(page) {

    document
        .querySelectorAll(".nav-item")
        .forEach(button => {
            button.classList.remove("active");
        });

    const map = {
        home: 0,
        favorites: 1,
        applications: 2,
        profile: 3
    };

    const index = map[page];

    if (index === undefined) return;

    const buttons =
        document.querySelectorAll(
            ".nav-item"
        );

    if (buttons[index]) {
        buttons[index].classList.add("active");
    }

}


// ============================================================
// ADMIN
// ============================================================

function renderAdminButton() {

    if (!state.isAdmin) return;

    const header = document.querySelector(
        ".header"
    );

    if (!header) return;

    if (document.getElementById("adminHeaderButton")) {
        return;
    }

    const button =
        document.createElement("button");

    button.id = "adminHeaderButton";

    button.className =
        "header-admin-button";

    button.textContent = "⚙️";

    button.onclick = openAdmin;

    header.appendChild(button);

}


async function openAdmin() {

    if (!state.isAdmin) {
        showToast("Нет доступа");
        return;
    }

    const modal = $("adminModal");
    const content = $("adminContent");

    if (!modal || !content) return;

    modal.classList.remove("hidden");

    content.innerHTML = `
        <div class="loading-screen">
            <div class="spinner"></div>
            <div>Загружаем админ-панель...</div>
        </div>
    `;

    try {

        const stats =
            await api("/api/admin/stats");

        const s = stats.stats;

        content.innerHTML = `
            <div class="admin-stats">

                <div class="stat-card">
                    <div class="stat-icon">👥</div>
                    <strong>${s.users}</strong>
                    <span>Пользователей</span>
                </div>

                <div class="stat-card">
                    <div class="stat-icon">💼</div>
                    <strong>${s.vacancies}</strong>
                    <span>Вакансий</span>
                </div>

                <div class="stat-card">
                    <div class="stat-icon">📩</div>
                    <strong>${s.applications}</strong>
                    <span>Откликов</span>
                </div>

            </div>

            <div class="admin-menu">

                <button
                    class="admin-menu-button"
                    onclick="adminVacancies()"
                >
                    💼 Управление вакансиями
                </button>

                <button
                    class="admin-menu-button"
                    onclick="adminApplications()"
                >
                    📩 Все отклики
                </button>

                <button
                    class="admin-menu-button"
                    onclick="adminCreateVacancy()"
                >
                    ➕ Добавить вакансию
                </button>

            </div>
        `;

    } catch (error) {

        content.innerHTML = `
            <div class="error-card">
                <div class="error-icon">⚠️</div>
                <p>${escapeHtml(error.message)}</p>
            </div>
        `;

    }

}


function closeAdmin() {

    const modal = $("adminModal");

    if (modal) {
        modal.classList.add("hidden");
    }

}


// ============================================================
// ADMIN VACANCIES
// ============================================================

async function adminVacancies() {

    const content = $("adminContent");

    if (!content) return;

    content.innerHTML = `
        <div class="loading-screen">
            <div class="spinner"></div>
            <div>Загрузка...</div>
        </div>
    `;

    try {

        const data =
            await api("/api/admin/vacancies");

        const vacancies =
            data.vacancies || [];

        content.innerHTML = `
            <div class="admin-page">

                <button
                    class="back-button"
                    onclick="openAdmin()"
                >
                    ← Назад
                </button>

                <h3>💼 Вакансии</h3>

                <button
                    class="primary-button"
                    onclick="adminCreateVacancy()"
                >
                    ➕ Добавить
                </button>

                <div class="admin-vacancy-list">

                    ${
                        vacancies.length
                            ? vacancies.map(adminVacancyCard).join("")
                            : `<div class="empty-state">
                                Вакансий нет
                            </div>`
                    }

                </div>

            </div>
        `;

    } catch (error) {

        showToast(error.message);

    }

}


function adminVacancyCard(vacancy) {

    return `
        <div class="admin-vacancy-card">

            <div>
                <strong>
                    ${escapeHtml(vacancy.title)}
                </strong>

                <div class="admin-meta">
                    ${escapeHtml(
                        vacancy.category || "Без категории"
                    )}
                </div>

                <div class="admin-meta">
                    ${
                        vacancy.active
                            ? "🟢 Активна"
                            : "🔴 Скрыта"
                    }
                </div>
            </div>

            <div class="admin-actions">

                <button
                    onclick="adminToggleVacancy(${vacancy.id})"
                >
                    ${vacancy.active ? "Скрыть" : "Включить"}
                </button>

                <button
                    class="danger-button"
                    onclick="adminDeleteVacancy(${vacancy.id})"
                >
                    Удалить
                </button>

            </div>

        </div>
    `;

}


async function adminToggleVacancy(id) {

    try {

        await api(
            `/api/admin/vacancy/${id}/toggle`,
            {
                method: "POST"
            }
        );

        await adminVacancies();

    } catch (error) {

        showToast(error.message);

    }

}


async function adminDeleteVacancy(id) {

    const confirmed =
        await showConfirm(
            "Удалить эту вакансию?"
        );

    if (!confirmed) return;

    try {

        await api(
            `/api/admin/vacancy/${id}`,
            {
                method: "DELETE"
            }
        );

        await adminVacancies();

    } catch (error) {

        showToast(error.message);

    }

}


// ============================================================
// ADMIN CREATE VACANCY
// ============================================================

function adminCreateVacancy() {

    const content = $("adminContent");

    if (!content) return;

    content.innerHTML = `
        <div class="admin-page">

            <button
                class="back-button"
                onclick="openAdmin()"
            >
                ← Назад
            </button>

            <h3>➕ Новая вакансия</h3>

            <div class="form-group">
                <label>Название</label>

                <input
                    id="adminTitle"
                    placeholder="Например: Водитель"
                >
            </div>

            <div class="form-group">
                <label>Категория</label>

                <input
                    id="adminCategory"
                    placeholder="Водители"
                >
            </div>

            <div class="form-group">
                <label>Зарплата</label>

                <input
                    id="adminSalary"
                    placeholder="От 80 000 ₽"
                >
            </div>

            <div class="form-group">
                <label>Описание</label>

                <textarea
                    id="adminDescription"
                    placeholder="Опишите работу..."
                ></textarea>
            </div>

            <div class="form-group">
                <label>Требования</label>

                <textarea
                    id="adminRequirements"
                    placeholder="Требования к кандидату..."
                ></textarea>
            </div>

            <div class="form-group">
                <label>Контакт</label>

                <input
                    id="adminContact"
                    placeholder="@username"
                >
            </div>

            <button
                class="primary-button"
                onclick="createAdminVacancy()"
            >
                💼 Создать вакансию
            </button>

        </div>
    `;

}


async function createAdminVacancy() {

    const data = {

        title:
            $("adminTitle")?.value.trim(),

        category:
            $("adminCategory")?.value.trim(),

        salary:
            $("adminSalary")?.value.trim(),

        description:
            $("adminDescription")?.value.trim(),

        requirements:
            $("adminRequirements")?.value.trim(),

        contact:
            $("adminContact")?.value.trim()

    };

    if (!data.title) {
        showToast("Введите название вакансии");
        return;
    }

    try {

        await api(
            "/api/admin/vacancy",
            {
                method: "POST",
                body: JSON.stringify(data)
            }
        );

        showToast("Вакансия создана");

        await loadCategories();

        await adminVacancies();

    } catch (error) {

        showToast(error.message);

    }

}


// ============================================================
// ADMIN APPLICATIONS
// ============================================================

async function adminApplications() {

    const content = $("adminContent");

    if (!content) return;

    content.innerHTML = `
        <div class="loading-screen">
            <div class="spinner"></div>
            <div>Загрузка откликов...</div>
        </div>
    `;

    try {

        const data =
            await api(
                "/api/admin/applications"
            );

        const applications =
            data.applications || [];

        if (!applications.length) {

            content.innerHTML = `
                <button
                    class="back-button"
                    onclick="openAdmin()"
                >
                    ← Назад
                </button>

                <div class="empty-state">
                    📩 Откликов пока нет
                </div>
            `;

            return;
        }

        content.innerHTML = `
            <div class="admin-page">

                <button
                    class="back-button"
                    onclick="openAdmin()"
                >
                    ← Назад
                </button>

                <h3>📩 Отклики</h3>

                <div class="admin-application-list">

                    ${
                        applications
                            .map(adminApplicationCard)
                            .join("")
                    }

                </div>

            </div>
        `;

    } catch (error) {

        showToast(error.message);

    }

}


function adminApplicationCard(application) {

    return `
        <div class="admin-application-card">

            <div class="admin-application-header">

                <strong>
                    ${escapeHtml(
                        application.title ||
                        "Вакансия"
                    )}
                </strong>

                <span>
                    #${application.id}
                </span>

            </div>

            <div class="admin-application-info">

                <div>
                    👤 ${escapeHtml(
                        application.name || "—"
                    )}
                </div>

                <div>
                    🎂 ${escapeHtml(
                        application.age || "—"
                    )}
                </div>

                <div>
                    📍 ${escapeHtml(
                        application.city || "—"
                    )}
                </div>

                <div>
                    📞 ${escapeHtml(
                        application.contact || "—"
                    )}
                </div>

            </div>

            <div class="admin-message">
                ${escapeHtml(
                    application.message || "—"
                ).replace(/\n/g, "<br>")}
            </div>

            <div class="admin-meta">
                ${formatDate(
                    application.created_at
                )}
            </div>

        </div>
    `;

}


// ============================================================
// MODAL CLICK OUTSIDE
// ============================================================

document.addEventListener("click", event => {

    if (
        event.target.classList.contains("modal")
    ) {

        event.target.classList.add("hidden");

    }

});


// ============================================================
// TELEGRAM BACK BUTTON
// ============================================================

if (tg?.BackButton) {

    tg.BackButton.onClick(() => {

        const vacancyModal =
            $("vacancyModal");

        const applicationModal =
            $("applicationModal");

        const profileModal =
            $("profileModal");

        const adminModal =
            $("adminModal");

        if (
            vacancyModal &&
            !vacancyModal.classList.contains("hidden")
        ) {
            closeModal();
            tg.BackButton.hide();
            return;
        }

        if (
            applicationModal &&
            !applicationModal.classList.contains("hidden")
        ) {
            closeApplication();
            tg.BackButton.hide();
            return;
        }

        if (
            profileModal &&
            !profileModal.classList.contains("hidden")
        ) {
            closeProfile();
            tg.BackButton.hide();
            return;
        }

        if (
            adminModal &&
            !adminModal.classList.contains("hidden")
        ) {
            closeAdmin();
            tg.BackButton.hide();
            return;
        }

    });

}


// ============================================================
// GLOBAL
// ============================================================

window.showHome = showHome;
window.showFavorites = showFavorites;
window.showApplications = showApplications;
window.openProfile = openProfile;
window.closeProfile = closeProfile;

window.clearSearch = clearSearch;
window.selectCategory = selectCategory;

window.openVacancy = openVacancy;
window.closeModal = closeModal;

window.toggleFavorite = toggleFavorite;

window.openApplication = openApplication;
window.closeApplication = closeApplication;
window.sendApplication = sendApplication;

window.saveProfile = saveProfile;

window.openAdmin = openAdmin;
window.closeAdmin = closeAdmin;

window.adminVacancies = adminVacancies;
window.adminApplications = adminApplications;
window.adminCreateVacancy = adminCreateVacancy;

window.createAdminVacancy =
    createAdminVacancy;

window.adminToggleVacancy =
    adminToggleVacancy;

window.adminDeleteVacancy =
    adminDeleteVacancy;
