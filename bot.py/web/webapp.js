```javascript
const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
    tg.enableClosingConfirmation?.();
}

const API_URL = "https://work-bot-h1go.onrender.com";

let currentUser = null;
let currentCategory = "";
let currentSearch = "";
let currentVacancyId = null;
let categories = [];

function initData() {
    return tg?.initData || "";
}

async function api(path, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData(),
        ...(options.headers || {})
    };

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers
    });

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error(`Ошибка сервера: ${response.status}`);
    }

    if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Произошла ошибка");
    }

    return data;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return "";

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showToast(message) {
    let toast = document.getElementById("toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.className = "toast";
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(window.toastTimer);

    window.toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2500);
}

function setActiveNav(index) {
    document.querySelectorAll(".nav-item").forEach((item, i) => {
        item.classList.toggle("active", i === index);
    });
}

function setLoading(text = "Загрузка...") {
    document.getElementById("content").innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <div>${escapeHtml(text)}</div>
        </div>
    `;
}

function setError(text) {
    document.getElementById("content").innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <h3>Не удалось загрузить</h3>
            <p>${escapeHtml(text)}</p>
            <button class="primary-button small" onclick="showHome()">
                Повторить
            </button>
        </div>
    `;
}

async function loadUser() {
    const data = await api("/api/me");

    currentUser = data.user;

    const hello = document.getElementById("hello");

    if (hello) {
        const name = currentUser?.first_name || "Поиск работы";
        hello.textContent = name === "Поиск работы"
            ? name
            : `Привет, ${name}!`;
    }

    return data;
}

async function loadCategories() {
    const data = await api("/api/categories");

    categories = data.categories || [];

    const container = document.getElementById("categories");

    container.innerHTML = `
        <button
            class="category ${currentCategory === "" ? "active" : ""}"
            onclick="selectCategory('')"
        >
            Все
        </button>
    `;

    categories.forEach(category => {
        container.innerHTML += `
            <button
                class="category ${currentCategory === category.name ? "active" : ""}"
                onclick="selectCategory(${JSON.stringify(category.name)})"
            >
                ${escapeHtml(category.name)}
                <span class="category-count">${category.count}</span>
            </button>
        `;
    });
}

async function loadVacancies() {
    setLoading();

    try {
        const params = new URLSearchParams();

        if (currentSearch) {
            params.set("search", currentSearch);
        }

        if (currentCategory) {
            params.set("category", currentCategory);
        }

        const data = await api(
            `/api/vacancies?${params.toString()}`
        );

        renderVacancies(data.vacancies || []);

    } catch (error) {
        console.error(error);
        setError(error.message);
    }
}

function renderVacancies(vacancies) {
    const content = document.getElementById("content");

    if (!vacancies.length) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔎</div>
                <h3>Вакансий не найдено</h3>
                <p>
                    Попробуйте изменить поиск или выбрать другую категорию.
                </p>
            </div>
        `;
        return;
    }

    content.innerHTML = `
        <div class="results-header">
            <span>Найдено вакансий: <b>${vacancies.length}</b></span>
        </div>

        <div class="vacancy-list">
            ${vacancies.map(renderVacancyCard).join("")}
        </div>
    `;
}

function renderVacancyCard(vacancy) {
    const favorite = vacancy.favorite;

    return `
        <article class="vacancy-card">
            <div class="vacancy-top">
                <div class="vacancy-icon">
                    ${getCategoryIcon(vacancy.category)}
                </div>

                <button
                    class="favorite-button ${favorite ? "favorite-active" : ""}"
                    onclick="toggleFavorite(event, ${vacancy.id})"
                    title="Избранное"
                >
                    ${favorite ? "❤️" : "♡"}
                </button>
            </div>

            <div
                class="vacancy-main"
                onclick="openVacancy(${vacancy.id})"
            >
                <h3>${escapeHtml(vacancy.title)}</h3>

                <div class="vacancy-meta">
                    ${
                        vacancy.category
                            ? `<span>📂 ${escapeHtml(vacancy.category)}</span>`
                            : ""
                    }

                    ${
                        vacancy.salary
                            ? `<span>💰 ${escapeHtml(vacancy.salary)}</span>`
                            : ""
                    }
                </div>

                ${
                    vacancy.description
                        ? `
                            <p class="vacancy-description">
                                ${escapeHtml(
                                    truncate(vacancy.description, 160)
                                )}
                            </p>
                        `
                        : ""
                }

                <div class="vacancy-footer">
                    <span>Подробнее →</span>
                </div>
            </div>
        </article>
    `;
}

function getCategoryIcon(category) {
    const value = String(category || "").toLowerCase();

    if (value.includes("водител")) return "🚗";
    if (value.includes("курьер")) return "🛵";
    if (value.includes("логист")) return "📦";
    if (value.includes("спорт")) return "🏆";
    if (value.includes("стро")) return "🔨";
    if (value.includes("продаж")) return "💼";
    if (value.includes("магаз")) return "🛒";
    if (value.includes("ресторан")) return "🍽️";
    if (value.includes("офис")) return "💻";

    return "💼";
}

function truncate(text, maxLength) {
    text = String(text || "");

    if (text.length <= maxLength) {
        return text;
    }

    return text.slice(0, maxLength) + "…";
}

function selectCategory(category) {
    currentCategory = category;

    document.querySelectorAll(".category").forEach(button => {
        button.classList.remove("active");
    });

    loadCategories().catch(console.error);
    loadVacancies();
}

function clearSearch() {
    const input = document.getElementById("searchInput");

    input.value = "";
    currentSearch = "";

    loadVacancies();
}

let searchTimer = null;

function setupSearch() {
    const input = document.getElementById("searchInput");

    if (!input) return;

    input.addEventListener("input", () => {
        clearTimeout(searchTimer);

        searchTimer = setTimeout(() => {
            currentSearch = input.value.trim();
            loadVacancies();
        }, 350);
    });
}

async function openVacancy(vacancyId) {
    currentVacancyId = vacancyId;

    try {
        const data = await api(`/api/vacancy/${vacancyId}`);
        renderVacancyModal(data.vacancy);

    } catch (error) {
        showToast(error.message);
    }
}

function renderVacancyModal(vacancy) {
    const modal = document.getElementById("vacancyModal");
    const content = document.getElementById("vacancyContent");

    content.innerHTML = `
        <div class="vacancy-detail">
            <div class="detail-icon">
                ${getCategoryIcon(vacancy.category)}
            </div>

            <h2>${escapeHtml(vacancy.title)}</h2>

            <div class="detail-tags">
                ${
                    vacancy.category
                        ? `<span>📂 ${escapeHtml(vacancy.category)}</span>`
                        : ""
                }

                ${
                    vacancy.salary
                        ? `<span>💰 ${escapeHtml(vacancy.salary)}</span>`
                        : ""
                }
            </div>

            <section class="detail-section">
                <h3>📝 Описание</h3>
                <p>${escapeHtml(
                    vacancy.description || "Описание не указано."
                )}</p>
            </section>

            <section class="detail-section">
                <h3>📌 Требования</h3>
                <p>${escapeHtml(
                    vacancy.requirements || "Требования не указаны."
                )}</p>
            </section>

            ${
                vacancy.contact
                    ? `
                        <section class="detail-section">
                            <h3>📞 Контакт</h3>
                            <p>${escapeHtml(vacancy.contact)}</p>
                        </section>
                    `
                    : ""
            }

            <button
                class="primary-button"
                onclick="openApplication(${vacancy.id})"
            >
                📩 Откликнуться
            </button>

            <button
                class="secondary-button"
                onclick="toggleFavoriteFromModal(${vacancy.id})"
            >
                ${vacancy.favorite ? "❤️ Убрать из избранного" : "♡ Добавить в избранное"}
            </button>
        </div>
    `;

    modal.classList.remove("hidden");

    if (tg) {
        tg.BackButton.show();
        tg.BackButton.onClick(closeModal);
    }
}

function closeModal() {
    document.getElementById("vacancyModal").classList.add("hidden");

    if (tg) {
        tg.BackButton.hide();
    }
}

async function toggleFavorite(event, vacancyId) {
    if (event) {
        event.stopPropagation();
    }

    try {
        const data = await api("/api/favorite", {
            method: "POST",
            body: JSON.stringify({
                vacancy_id: vacancyId
            })
        });

        showToast(
            data.favorite
                ? "❤️ Добавлено в избранное"
                : "Удалено из избранного"
        );

        await loadVacancies();

    } catch (error) {
        showToast(error.message);
    }
}

async function toggleFavoriteFromModal(vacancyId) {
    try {
        const data = await api("/api/favorite", {
            method: "POST",
            body: JSON.stringify({
                vacancy_id: vacancyId
            })
        });

        showToast(
            data.favorite
                ? "❤️ Добавлено в избранное"
                : "Удалено из избранного"
        );

        await openVacancy(vacancyId);

    } catch (error) {
        showToast(error.message);
    }
}

function openApplication(vacancyId) {
    currentVacancyId = vacancyId;

    document.getElementById("applicationModal")
        .classList.remove("hidden");

    if (currentUser) {
        document.getElementById("applyAge").value =
            currentUser.age || "";

        document.getElementById("applyCity").value =
            currentUser.city || "";

        if (currentUser.username) {
            document.getElementById("applyContact").value =
                "@" + currentUser.username.replace("@", "");
        }
    }

    closeModal();
}

function closeApplication() {
    document.getElementById("applicationModal")
        .classList.add("hidden");
}

async function sendApplication() {
    if (!currentVacancyId) {
        showToast("Вакансия не выбрана");
        return;
    }

    const age = Number(
        document.getElementById("applyAge").value
    );

    const city = document.getElementById("applyCity").value.trim();

    const contact = document
        .getElementById("applyContact")
        .value.trim();

    const message = document
        .getElementById("applyMessage")
        .value.trim();

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

    const button = document.querySelector(
        "#applicationModal .primary-button"
    );

    button.disabled = true;
    button.textContent = "Отправка...";

    try {
        const data = await api("/api/apply", {
            method: "POST",
            body: JSON.stringify({
                vacancy_id: currentVacancyId,
                age,
                city,
                contact,
                message
            })
        });

        showToast(
            `Отклик №${data.application_id} отправлен!`
        );

        document.getElementById("applyMessage").value = "";

        closeApplication();

    } catch (error) {
        showToast(error.message);

    } finally {
        button.disabled = false;
        button.textContent = "📩 Отправить отклик";
    }
}

async function showHome() {
    setActiveNav(0);

    document.getElementById("content").scrollTop = 0;

    await loadVacancies();
}

async function showFavorites() {
    setActiveNav(1);
    setLoading("Загрузка избранного...");

    try {
        const data = await api("/api/favorites");

        const vacancies = data.vacancies || [];

        if (!vacancies.length) {
            document.getElementById("content").innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❤️</div>
                    <h3>Избранное пусто</h3>
                    <p>
                        Добавляйте понравившиеся вакансии,
                        чтобы быстро найти их позже.
                    </p>
                </div>
            `;
            return;
        }

        renderVacancies(vacancies);

    } catch (error) {
        setError(error.message);
    }
}

async function showApplications() {
    setActiveNav(2);
    setLoading("Загрузка откликов...");

    try {
        const data = await api("/api/my-applications");

        const applications = data.applications || [];

        if (!applications.length) {
            document.getElementById("content").innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📩</div>
                    <h3>Откликов пока нет</h3>
                    <p>
                        Здесь будут отображаться вакансии,
                        на которые вы отправили заявку.
                    </p>
                </div>
            `;
            return;
        }

        document.getElementById("content").innerHTML = `
            <div class="page-heading">
                <h2>📩 Мои отклики</h2>
                <p>История отправленных заявок</p>
            </div>

            <div class="applications-list">
                ${applications.map(renderApplication).join("")}
            </div>
        `;

    } catch (error) {
        setError(error.message);
    }
}

function renderApplication(application) {
    const status = application.status || "new";

    const statusMap = {
        new: ["Новый", "status-new"],
        accepted: ["Принят", "status-accepted"],
        rejected: ["Отклонён", "status-rejected"],
        pending: ["На рассмотрении", "status-pending"]
    };

    const statusInfo =
        statusMap[status] || ["Новый", "status-new"];

    return `
        <article class="application-card">
            <div class="application-header">
                <div>
                    <h3>
                        ${escapeHtml(
                            application.title || "Вакансия"
                        )}
                    </h3>

                    <small>
                        Отклик №${application.id}
                    </small>
                </div>

                <span class="status ${statusInfo[1]}">
                    ${statusInfo[0]}
                </span>
            </div>

            <div class="application-info">
                <div>
                    <b>🏙️ Город:</b>
                    ${escapeHtml(application.city || "—")}
                </div>

                <div>
                    <b>🎂 Возраст:</b>
                    ${escapeHtml(application.age || "—")}
                </div>

                <div>
                    <b>📞 Контакт:</b>
                    ${escapeHtml(application.contact || "—")}
                </div>
            </div>

            ${
                application.message
                    ? `
                        <div class="application-message">
                            ${escapeHtml(application.message)}
                        </div>
                    `
                    : ""
            }
        </article>
    `;
}

async function openProfile() {
    try {
        const data = await api("/api/me");

        currentUser = data.user;

        renderProfile(currentUser, data.is_admin);

        document.getElementById("profileModal")
            .classList.remove("hidden");

    } catch (error) {
        showToast(error.message);
    }
}

function renderProfile(user, isAdmin) {
    const content = document.getElementById("profileContent");

    content.innerHTML = `
        <div class="profile-avatar">
            ${escapeHtml(
                (user.first_name || "👤").charAt(0).toUpperCase()
            )}
        </div>

        <div class="profile-name">
            ${escapeHtml(user.first_name || "Пользователь")}
        </div>

        ${
            user.username
                ? `
                    <div class="profile-username">
                        @${escapeHtml(
                            user.username.replace("@", "")
                        )}
                    </div>
                `
                : ""
        }

        <div class="profile-form">

            <div class="form-group">
                <label>Имя</label>
                <input
                    id="profileName"
                    type="text"
                    value="${escapeHtml(user.first_name || "")}"
                    placeholder="Ваше имя"
                >
            </div>

            <div class="form-group">
                <label>Город</label>
                <input
                    id="profileCity"
                    type="text"
                    value="${escapeHtml(user.city || "")}"
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
                            ? "@" + user.username.replace("@", "")
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
                isAdmin
                    ? `
                        <button
                            class="admin-button"
                            onclick="openAdmin()"
                        >
                            ⚙️ Админ-панель
                        </button>
                    `
                    : ""
            }

        </div>
    `;
}

async function saveProfile() {
    const first_name = document
        .getElementById("profileName")
        .value.trim();

    const city = document
        .getElementById("profileCity")
        .value.trim();

    const age = Number(
        document.getElementById("profileAge").value
    );

    const username = document
        .getElementById("profileUsername")
        .value.trim();

    try {
        const data = await api("/api/profile", {
            method: "POST",
            body: JSON.stringify({
                first_name,
                city,
                age,
                username
            })
        });

        currentUser = data.user;

        showToast("Профиль сохранён");

        closeProfile();

        const hello = document.getElementById("hello");

        if (hello && currentUser.first_name) {
            hello.textContent =
                `Привет, ${currentUser.first_name}!`;
        }

    } catch (error) {
        showToast(error.message);
    }
}

function closeProfile() {
    document.getElementById("profileModal")
        .classList.add("hidden");
}

async function openAdmin() {
    closeProfile();

    document.getElementById("adminModal")
        .classList.remove("hidden");

    await loadAdmin();
}

function closeAdmin() {
    document.getElementById("adminModal")
        .classList.add("hidden");
}

async function loadAdmin() {
    const content = document.getElementById("adminContent");

    content.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            Загрузка админ-панели...
        </div>
    `;

    try {
        const stats = await api("/api/admin/stats");

        content.innerHTML = `
            <div class="admin-stats">

                <div class="stat-card">
                    <span>👥</span>
                    <b>${stats.stats.users}</b>
                    <small>Пользователи</small>
                </div>

                <div class="stat-card">
                    <span>💼</span>
                    <b>${stats.stats.vacancies}</b>
                    <small>Вакансии</small>
                </div>

                <div class="stat-card">
                    <span>📩</span>
                    <b>${stats.stats.applications}</b>
                    <small>Отклики</small>
                </div>

            </div>

            <div class="admin-actions">
                <button
                    class="primary-button"
                    onclick="showAdminVacancies()"
                >
                    💼 Управление вакансиями
                </button>

                <button
                    class="secondary-button"
                    onclick="showAdminApplications()"
                >
                    📩 Все отклики
                </button>

                <button
                    class="secondary-button"
                    onclick="showCreateVacancy()"
                >
                    ➕ Добавить вакансию
                </button>
            </div>
        `;

    } catch (error) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔒</div>
                <h3>Нет доступа</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>
        `;
    }
}

async function showAdminVacancies() {
    const content = document.getElementById("adminContent");

    content.innerHTML = `
        <div class="admin-loading">
            Загрузка...
        </div>
    `;

    try {
        const data = await api("/api/admin/vacancies");

        const vacancies = data.vacancies || [];

        content.innerHTML = `
            <div class="admin-title-row">
                <h3>💼 Вакансии</h3>

                <button
                    class="small-button"
                    onclick="showCreateVacancy()"
                >
                    ➕ Добавить
                </button>
            </div>

            <div class="admin-vacancies">
                ${
                    vacancies.length
                        ? vacancies.map(renderAdminVacancy).join("")
                        : `<div class="empty-state">Вакансий нет.</div>`
                }
            </div>

            <button
                class="secondary-button"
                onclick="loadAdmin()"
            >
                ← Назад
            </button>
        `;

    } catch (error) {
        content.innerHTML = `
            <div class="empty-state">
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderAdminVacancy(vacancy) {
    return `
        <div class="admin-vacancy-card">

            <div>
                <h4>
                    ${escapeHtml(vacancy.title)}
                </h4>

                <div class="admin-vacancy-meta">
                    ${escapeHtml(
                        vacancy.category || "Без категории"
                    )}

                    ${
                        vacancy.salary
                            ? ` • ${escapeHtml(vacancy.salary)}`
                            : ""
                    }
                </div>

                <span class="${
                    vacancy.active
                        ? "active-label"
                        : "inactive-label"
                }">
                    ${vacancy.active ? "Активна" : "Скрыта"}
                </span>
            </div>

            <div class="admin-buttons">

                <button
                    class="small-button"
                    onclick="toggleAdminVacancy(${vacancy.id})"
                >
                    ${vacancy.active ? "Скрыть" : "Активировать"}
                </button>

                <button
                    class="danger-button"
                    onclick="deleteAdminVacancy(${vacancy.id})"
                >
                    Удалить
                </button>

            </div>

        </div>
    `;
}

async function toggleAdminVacancy(vacancyId) {
    try {
        await api(
            `/api/admin/vacancy/${vacancyId}/toggle`,
            {
                method: "POST"
            }
        );

        showToast("Статус вакансии изменён");

        await showAdminVacancies();

    } catch (error) {
        showToast(error.message);
    }
}

async function deleteAdminVacancy(vacancyId) {
    const confirmed = confirm(
        "Удалить эту вакансию?"
    );

    if (!confirmed) return;

    try {
        await api(
            `/api/admin/vacancy/${vacancyId}`,
            {
                method: "DELETE"
            }
        );

        showToast("Вакансия удалена");

        await showAdminVacancies();

    } catch (error) {
        showToast(error.message);
    }
}

function showCreateVacancy() {
    const content = document.getElementById("adminContent");

    content.innerHTML = `
        <div class="admin-title-row">
            <h3>➕ Новая вакансия</h3>
        </div>

        <div class="form-group">
            <label>Название</label>
            <input
                id="adminTitle"
                type="text"
                placeholder="Например: Водитель"
            >
        </div>

        <div class="form-group">
            <label>Категория</label>
            <select id="adminCategory">
                <option value="">Выберите категорию</option>
                <option value="Водитель">🚗 Водитель</option>
                <option value="Курьер">🛵 Курьер</option>
                <option value="Логист">📦 Логист</option>
                <option value="Спортсмен">🏆 Спортсмен</option>
                <option value="Продажи">💼 Продажи</option>
                <option value="Офис">💻 Офис</option>
                <option value="Другое">📌 Другое</option>
            </select>
        </div>

        <div class="form-group">
            <label>Зарплата</label>
            <input
                id="adminSalary"
                type="text"
                placeholder="Например: от 80 000 ₽"
            >
        </div>

        <div class="form-group">
            <label>Описание</label>
            <textarea
                id="adminDescription"
                placeholder="Описание работы"
            ></textarea>
        </div>

        <div class="form-group">
            <label>Требования</label>
            <textarea
                id="adminRequirements"
                placeholder="Требования к кандидату"
            ></textarea>
        </div>

        <div class="form-group">
            <label>Контакт</label>
            <input
                id="adminContact"
                type="text"
                placeholder="@username или другой контакт"
            >
        </div>

        <button
            class="primary-button"
            onclick="createVacancy()"
        >
            💾 Создать вакансию
        </button>

        <button
            class="secondary-button"
            onclick="loadAdmin()"
        >
            ← Назад
        </button>
    `;
}

async function createVacancy() {
    const title = document
        .getElementById("adminTitle")
        .value.trim();

    const category = document
        .getElementById("adminCategory")
        .value.trim();

    const salary = document
        .getElementById("adminSalary")
        .value.trim();

    const description = document
        .getElementById("adminDescription")
        .value.trim();

    const requirements = document
        .getElementById("adminRequirements")
        .value.trim();

    const contact = document
        .getElementById("adminContact")
        .value.trim();

    if (!title) {
        showToast("Введите название вакансии");
        return;
    }

    try {
        const data = await api(
            "/api/admin/vacancy",
            {
                method: "POST",
                body: JSON.stringify({
                    title,
                    category,
                    salary,
                    description,
                    requirements,
                    contact
                })
            }
        );

        showToast(
            `Вакансия №${data.vacancy_id} создана`
        );

        await showAdminVacancies();

    } catch (error) {
        showToast(error.message);
    }
}

async function showAdminApplications() {
    const content = document.getElementById("adminContent");

    content.innerHTML = `
        <div class="admin-loading">
            Загрузка откликов...
        </div>
    `;

    try {
        const data = await api(
            "/api/admin/applications"
        );

        const applications =
            data.applications || [];

        content.innerHTML = `
            <div class="admin-title-row">
                <h3>📩 Отклики</h3>
            </div>

            ${
                applications.length
                    ? `
                        <div class="admin-applications">
                            ${applications
                                .map(
                                    renderAdminApplication
                                )
                                .join("")}
                        </div>
                    `
                    : `
                        <div class="empty-state">
                            Откликов пока нет.
                        </div>
                    `
            }

            <button
                class="secondary-button"
                onclick="loadAdmin()"
            >
                ← Назад
            </button>
        `;

    } catch (error) {
        content.innerHTML = `
            <div class="empty-state">
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderAdminApplication(application) {
    return `
        <article class="admin-application-card">

            <div class="admin-app-header">
                <div>
                    <h4>
                        ${escapeHtml(
                            application.title || "Вакансия"
                        )}
                    </h4>

                    <small>
                        Отклик №${application.id}
                    </small>
                </div>

                <span class="status status-new">
                    ${escapeHtml(
                        application.status || "new"
                    )}
                </span>
            </div>

            <div class="admin-app-info">

                <p>
                    <b>👤 Имя:</b>
                    ${escapeHtml(application.name || "—")}
                </p>

                <p>
                    <b>🎂 Возраст:</b>
                    ${escapeHtml(application.age || "—")}
                </p>

                <p>
                    <b>🏙️ Город:</b>
                    ${escapeHtml(application.city || "—")}
                </p>

                <p>
                    <b>📞 Контакт:</b>
                    ${escapeHtml(application.contact || "—")}
                </p>

                <p>
                    <b>📝 О себе:</b><br>
                    ${escapeHtml(application.message || "—")}
                </p>

                <p class="application-date">
                    ${escapeHtml(
                        application.created_at || ""
                    )}
                </p>

            </div>

        </article>
    `;
}

function setupModalClosing() {
    document.querySelectorAll(".modal").forEach(modal => {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                modal.classList.add("hidden");
            }
        });
    });
}

async function initApp() {
    setupSearch();
    setupModalClosing();

    try {
        await loadUser();
        await loadCategories();
        await loadVacancies();

    } catch (error) {
        console.error(error);

        setError(
            "Не удалось подключиться к серверу. " +
            "Проверьте API_URL в app.js."
        );
    }
}

document.addEventListener(
    "DOMContentLoaded",
    initApp
);
```
