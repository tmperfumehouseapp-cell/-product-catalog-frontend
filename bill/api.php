<?php
declare(strict_types=1);

/**
 * ORDER LEDGER: the complete backend in this ONE file.
 *
 * It creates the database tables by itself the first time it runs, so there are no SQL files.
 * To move between your computer and Hostinger you only change USE_DATABASE below.
 * Everything else (pages, styles, scripts) never needs touching.
 */

/* ================================================================== *
 * 1. YOUR SETTINGS. This is the only part you ever edit.            *
 * ================================================================== */

// 'local'     = run on your own computer (XAMPP, Laragon, or "php -S localhost:8000")
// 'hostinger' = run on the live Hostinger site
const USE_DATABASE = 'hostinger';

// Every ledger table gets this prefix (bill_orders, bill_customers ...), so the ledger can share a
// database with another project without touching any of that project's tables. Do not change it
// after the first run.
const TABLE_PREFIX = 'bill_';

const DATABASES = [
    // Your computer. XAMPP default is user "root" with an empty password.
    // If this database does not exist yet, it is created for you.
    'local' => [
        'host' => 'localhost',
        'name' => 'order_ledger',
        'user' => 'root',
        'pass' => '',
    ],
    // Hostinger: hPanel > Databases > MySQL Databases. Create a database, then copy the details here.
    'hostinger' => [
        'host' => 'localhost',
        'name' => 'u897577217_visitor',
        'user' => 'u897577217_visitor',
        'pass' => 'Thirdparty!1212',
    ],
];

// Shiprocket: lets the "Get AWB from Shiprocket" buttons fill tracking IDs for you.
// In Shiprocket go to Settings > API > Configure > Create API User, then put that user's email and
// password here. (Use an API user, not your normal Shiprocket login.) Leave empty to switch it off.
const SHIPROCKET = [
    'email'    => '',
    'password' => '',
    'base'     => 'https://apiv2.shiprocket.in/v1/external',
];

const SETTINGS = [
    'app_name'             => 'Order Ledger',
    'timezone'             => 'Asia/Kolkata',
    'allowed_ips'          => [],    // optional: ['203.0.113.10'] lets only that IP in
    'ip_header'            => '',    // only behind a proxy, for example 'HTTP_CF_CONNECTING_IP'
    'order_prefix'         => 'OG',  // order numbers look like OG01, OG02 ...
    'order_digits'         => 2,     // at least this many digits: 2 gives OG01, OG09, OG10, OG100
    'back_url'             => '',    // optional 'Back to admin' button in the top bar, for example '../add_product.html'
    'catalog_api'          => '../get_products.php',  // your catalog's product search, used to suggest items with photos on New order ('' = off)

    // Shown on every invoice. Fill in what you need; anything left '' stays as it is.
    // In the address and bank details, write \n where you want a new line.
    'business' => [
        'business_name'    => '',
        'business_address' => '',
        'business_phone'   => '',
        'business_email'   => '',
        'gstin'            => '',
        'upi_id'           => '',
        'bank_details'     => '',
        'invoice_terms'    => '',
        'invoice_footer'   => '',
    ],
];

/* ================================================================== *
 * 2. CORE: config, database, security, sign-in                       *
 * ================================================================== */

function cfg(string $path, mixed $default = null): mixed
{
    $value = SETTINGS + ['db' => DATABASES];
    foreach (explode('.', $path) as $key) {
        if (!is_array($value) || !array_key_exists($key, $value)) {
            return $default;
        }
        $value = $value[$key];
    }
    return $value;
}

/** 'test' while running on your computer, 'live' on Hostinger. */
function app_env(): string
{
    return USE_DATABASE === 'hostinger' ? 'live' : 'test';
}

date_default_timezone_set((string) cfg('timezone', 'Asia/Kolkata'));

/** PDO that adds TABLE_PREFIX to the ledger's own table names in every query it runs. */
class PrefixPDO extends PDO
{
    private static function px(string $sql): string
    {
        static $re = '/\b(accounts|audit_log|counters|customers|order_items|orders|payments|products|settings|shipments|users|salesmen|fk_[a-z_]+)\b/';
        return preg_replace($re, TABLE_PREFIX . '$1', $sql);
    }

    #[\ReturnTypeWillChange]
    public function prepare(string $query, array $options = [])
    {
        return parent::prepare(self::px($query), $options);
    }

    #[\ReturnTypeWillChange]
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs)
    {
        $query = self::px($query);
        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
    }

    #[\ReturnTypeWillChange]
    public function exec(string $statement)
    {
        return parent::exec(self::px($statement));
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $c = DATABASES[USE_DATABASE] ?? null;
    if (!is_array($c)) {
        throw new ApiError("USE_DATABASE at the top of api.php must be 'local' or 'hostinger'.", 500);
    }
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    $dsn = static fn(bool $withDb): string => 'mysql:host=' . $c['host'] . ($withDb ? ';dbname=' . $c['name'] : '') . ';charset=utf8mb4';
    try {
        try {
            $conn = new PrefixPDO($dsn(true), (string) $c['user'], (string) $c['pass'], $opts);
        } catch (PDOException $e) {
            // Unknown database: on your own computer, create it.
            if (USE_DATABASE === 'local' && (int) ($e->errorInfo[1] ?? 0) === 1049) {
                $tmp = new PDO($dsn(false), (string) $c['user'], (string) $c['pass'], $opts);
                $tmp->exec('CREATE DATABASE IF NOT EXISTS `' . str_replace('`', '', (string) $c['name']) . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
                $conn = new PrefixPDO($dsn(true), (string) $c['user'], (string) $c['pass'], $opts);
            } else {
                throw $e;
            }
        }
        $conn->exec("SET time_zone = '+05:30'");
        ensure_schema($conn);
    } catch (PDOException $e) {
        error_log('DB connection failed (' . USE_DATABASE . '): ' . $e->getMessage());
        throw new ApiError('Cannot connect to the "' . USE_DATABASE . '" database. Check its details at the top of api.php.'
            . (app_env() === 'test' ? ' (' . $e->getMessage() . ')' : ''), 500);
    }
    $pdo = $conn;
    return $pdo;
}

/** Creates every table the first time (and fills in anything missing). Safe to run again. */
function ensure_schema(PDO $pdo): void
{
    if ($pdo->query("SHOW TABLES LIKE 'shipments'")->fetchColumn() === false) {
        foreach (split_sql(SCHEMA_SQL) as $stmt) {
            $pdo->exec($stmt);
        }
        return;
    }
    // Databases made by an older api.php: add the parcel size and weight columns once.
    if ($pdo->query("SHOW COLUMNS FROM shipments LIKE 'weight_g'")->fetchColumn() === false) {
        $pdo->exec('ALTER TABLE shipments
            ADD COLUMN length_cm  DECIMAL(6,1) NULL AFTER note,
            ADD COLUMN breadth_cm DECIMAL(6,1) NULL AFTER length_cm,
            ADD COLUMN height_cm  DECIMAL(6,1) NULL AFTER breadth_cm,
            ADD COLUMN weight_g   INT UNSIGNED NULL AFTER height_cm');
    }
    // Product photos: add the image columns once.
    foreach (['products', 'order_items'] as $tbl) {
        if ($pdo->query("SHOW COLUMNS FROM $tbl LIKE 'image'")->fetchColumn() === false) {
            $pdo->exec("ALTER TABLE $tbl ADD COLUMN image VARCHAR(255) NOT NULL DEFAULT ''");
        }
    }
    // Salesperson on each order, and the purchase price of each item (NULL = not entered).
    if ($pdo->query("SHOW COLUMNS FROM orders LIKE 'salesperson'")->fetchColumn() === false) {
        $pdo->exec("ALTER TABLE orders ADD COLUMN salesperson VARCHAR(60) NOT NULL DEFAULT '' AFTER source");
    }
    if ($pdo->query("SHOW COLUMNS FROM order_items LIKE 'cost_paise'")->fetchColumn() === false) {
        $pdo->exec('ALTER TABLE order_items ADD COLUMN cost_paise BIGINT NULL AFTER rate_paise');
    }
    // The list of salesmen shown in the dropdown. Names already typed on earlier orders are copied in once.
    if ($pdo->query("SHOW TABLES LIKE 'salesmen'")->fetchColumn() === false) {
        $pdo->exec('CREATE TABLE salesmen (
            id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
            name       VARCHAR(60)  NOT NULL,
            created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_salesmen_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $pdo->exec("INSERT IGNORE INTO salesmen (name) SELECT DISTINCT salesperson FROM orders WHERE salesperson <> ''");
    }
    // Order numbers look like OG01, OG02 ...: rename older ones (1, 2 or TM-2) once.
    if ($pdo->query("SELECT 1 FROM settings WHERE k = 'order_numbers_og'")->fetchColumn() === false) {
        $prefix = (string) (SETTINGS['order_prefix'] ?? 'OG');
        $digits = (int) (SETTINGS['order_digits'] ?? 2);
        $old = $pdo->query('SELECT id, order_no FROM orders')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($old as $r) {
            if (preg_match('/(\\d+)$/', (string) $r['order_no'], $m)) {
                $new = $prefix . str_pad((string) ((int) $m[1]), $digits, '0', STR_PAD_LEFT);
                if ($new === $r['order_no']) {
                    continue;
                }
                try {
                    $pdo->prepare('UPDATE orders SET order_no = ? WHERE id = ?')->execute([$new, (int) $r['id']]);
                } catch (PDOException $e) {
                    // that number is already taken: leave this order as it is
                }
            }
        }
        $pdo->exec("INSERT IGNORE INTO settings (k, v) VALUES ('order_numbers_og', '1')");
    }
}

/** Split SQL text into single statements (respects quotes and comments). */
function split_sql(string $sql): array
{
    $out = [];
    $cur = '';
    $len = strlen($sql);
    $q = '';
    for ($i = 0; $i < $len; $i++) {
        $c = $sql[$i];
        $n = $sql[$i + 1] ?? '';
        if ($q !== '') {
            $cur .= $c;
            if ($c === '\\' && $q !== '`') {
                $cur .= $n;
                $i++;
            } elseif ($c === $q) {
                if ($n === $q) {
                    $cur .= $n;
                    $i++;
                } else {
                    $q = '';
                }
            }
            continue;
        }
        if (($c === '-' && $n === '-') || $c === '#') {
            while ($i < $len && $sql[$i] !== "\n") {
                $i++;
            }
            continue;
        }
        if ($c === '/' && $n === '*') {
            $end = strpos($sql, '*/', $i + 2);
            $i = $end === false ? $len : $end + 1;
            continue;
        }
        if ($c === "'" || $c === '"' || $c === '`') {
            $q = $c;
            $cur .= $c;
            continue;
        }
        if ($c === ';') {
            if (trim($cur) !== '') {
                $out[] = trim($cur);
            }
            $cur = '';
            continue;
        }
        $cur .= $c;
    }
    if (trim($cur) !== '') {
        $out[] = trim($cur);
    }
    return $out;
}

const SCHEMA_SQL = <<<'SQL'
-- Step 1: access control. Import once in phpMyAdmin (Import tab) into your empty database.
-- Internal system for two people only. There is no registration table or flow.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(40)  NOT NULL,
  full_name     VARCHAR(80)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NULL,
  action     VARCHAR(60)  NOT NULL,
  entity     VARCHAR(40)  NULL,
  entity_id  BIGINT UNSIGNED NULL,
  details    TEXT         NULL,
  ip         VARCHAR(45)  NOT NULL DEFAULT '',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_entity (entity, entity_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Step 2: orders, invoices, payments, shipments, customers, accounts.
-- Import AFTER 001_access.sql, once per database (test and live). Safe to import twice.
-- All money columns are whole paise (1 rupee = 100 paise).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(60) NOT NULL,
  v TEXT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (k, v) VALUES
  ('business_name',    'Your Business Name'),
  ('business_address', ''),
  ('business_phone',   ''),
  ('business_email',   ''),
  ('gstin',            ''),
  ('upi_id',           ''),
  ('bank_details',     ''),
  ('invoice_prefix',   'INV-'),
  ('invoice_terms',    'Goods once sold will not be taken back unless damaged in transit.'),
  ('invoice_footer',   'Thank you for your order.');

CREATE TABLE IF NOT EXISTS counters (
  name  VARCHAR(30) NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO counters (name, value) VALUES ('order', 0), ('invoice', 0);

CREATE TABLE IF NOT EXISTS accounts (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(60)  NOT NULL,
  type          ENUM('bank','upi','cash','wallet','other') NOT NULL DEFAULT 'bank',
  opening_paise BIGINT       NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO accounts (name, type) VALUES ('Cash', 'cash');

CREATE TABLE IF NOT EXISTS customers (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120) NOT NULL,
  phone         VARCHAR(15)  NOT NULL,
  city          VARCHAR(60)  NOT NULL DEFAULT '',
  pincode       VARCHAR(10)  NOT NULL DEFAULT '',
  address       VARCHAR(255) NOT NULL DEFAULT '',
  notes         VARCHAR(255) NOT NULL DEFAULT '',
  opening_paise BIGINT       NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_phone (phone),
  KEY idx_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sku        VARCHAR(40)  NULL,
  name       VARCHAR(160) NOT NULL,
  rate_paise BIGINT       NOT NULL DEFAULT 0,
  cost_paise BIGINT       NOT NULL DEFAULT 0,
  image      VARCHAR(255) NOT NULL DEFAULT '',
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no       VARCHAR(30)  NOT NULL,
  customer_id    INT UNSIGNED NOT NULL,
  order_date     DATE         NOT NULL,
  status         ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  pay_plan       ENUM('prepaid','advance','cod','credit') NOT NULL DEFAULT 'credit',
  source         VARCHAR(30)  NOT NULL DEFAULT 'WhatsApp',
  salesperson    VARCHAR(60)  NOT NULL DEFAULT '',
  subtotal_paise BIGINT       NOT NULL DEFAULT 0,
  discount_paise BIGINT       NOT NULL DEFAULT 0,
  shipping_paise BIGINT       NOT NULL DEFAULT 0,
  total_paise    BIGINT       NOT NULL DEFAULT 0,
  due_date       DATE         NULL,
  ship_address   VARCHAR(255) NOT NULL DEFAULT '',
  ship_city      VARCHAR(60)  NOT NULL DEFAULT '',
  ship_pincode   VARCHAR(10)  NOT NULL DEFAULT '',
  notes          VARCHAR(500) NOT NULL DEFAULT '',
  invoice_no     VARCHAR(30)  NULL,
  invoice_date   DATE         NULL,
  cancelled_at   DATETIME     NULL,
  cancel_reason  VARCHAR(200) NOT NULL DEFAULT '',
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_no (order_no),
  UNIQUE KEY uq_orders_invoice (invoice_no),
  KEY idx_orders_customer (customer_id, order_date),
  KEY idx_orders_date (order_date),
  KEY idx_orders_status_due (status, due_date),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_orders_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salesmen (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(60)  NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_salesmen_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id       INT UNSIGNED NOT NULL,
  position       SMALLINT     NOT NULL DEFAULT 0,
  product_id     INT UNSIGNED NULL,
  name           VARCHAR(160) NOT NULL,
  qty            INT          NOT NULL,
  rate_paise     BIGINT       NOT NULL,
  cost_paise     BIGINT       NULL,
  discount_paise BIGINT       NOT NULL DEFAULT 0,
  amount_paise   BIGINT       NOT NULL,
  image          VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_items_order (order_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  INT UNSIGNED NOT NULL,
  order_id     INT UNSIGNED NULL,
  type         ENUM('received','refund') NOT NULL DEFAULT 'received',
  purpose      VARCHAR(12)  NOT NULL DEFAULT 'balance',
  amount_paise BIGINT       NOT NULL,
  method       ENUM('upi','bank_transfer','cash','cheque','card','wallet','other') NOT NULL DEFAULT 'upi',
  account_id   INT UNSIGNED NOT NULL,
  reference    VARCHAR(80)  NOT NULL DEFAULT '',
  received_on  DATE         NOT NULL,
  note         VARCHAR(200) NOT NULL DEFAULT '',
  voided_at    DATETIME     NULL,
  void_reason  VARCHAR(200) NOT NULL DEFAULT '',
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payments_customer (customer_id, received_on),
  KEY idx_payments_order (order_id),
  KEY idx_payments_date (received_on),
  KEY idx_payments_account (account_id, received_on),
  CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_payments_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_payments_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipments (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      INT UNSIGNED NOT NULL,
  courier       VARCHAR(40)  NOT NULL DEFAULT '',
  tracking_id   VARCHAR(60)  NOT NULL DEFAULT '',
  status        ENUM('pending','packed','dispatched','delivered','returned') NOT NULL DEFAULT 'pending',
  packed_on     DATE         NULL,
  dispatched_on DATE         NULL,
  delivered_on  DATE         NULL,
  note          VARCHAR(200) NOT NULL DEFAULT '',
  length_cm     DECIMAL(6,1) NULL,
  breadth_cm    DECIMAL(6,1) NULL,
  height_cm     DECIMAL(6,1) NULL,
  weight_g      INT UNSIGNED NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_shipments_order (order_id),
  KEY idx_shipments_tracking (tracking_id),
  KEY idx_shipments_status (status),
  CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL;

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

/** Escape text for HTML output. Use on every value printed into a page. */
function h(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}


function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function client_ip(): string
{
    $header = (string) cfg('ip_header', '');
    if ($header !== '' && !empty($_SERVER[$header])) {
        $ip = trim(explode(',', (string) $_SERVER[$header])[0]);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

/* ------------------------------------------------------------------ */
/* Boot: errors, IP allow-list, headers, session                      */
/* ------------------------------------------------------------------ */

/** Call once at the top of every public page. Safe to call twice. */
function boot(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    error_reporting(E_ALL);
    set_exception_handler(static function (Throwable $e): void {
        error_log('Unhandled: ' . get_class($e) . ' ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        if (!headers_sent()) {
            http_response_code(500);
        }
        echo 'Something went wrong. Please try again.';
        // Test environment only: show the real reason so problems are easy to fix.
        if (app_env() === 'test') {
            echo '<pre>' . h(get_class($e) . ': ' . $e->getMessage() . "\n" . basename($e->getFile()) . ':' . $e->getLine()) . '</pre>';
        }
    });

    enforce_ip_allowlist();
    send_security_headers();
    start_secure_session();
}

function enforce_ip_allowlist(): void
{
    $allowed = cfg('allowed_ips', []);
    if (is_array($allowed) && $allowed !== [] && !in_array(client_ip(), $allowed, true)) {
        http_response_code(403);
        exit('Access denied.');
    }
}

function send_security_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    header('Cache-Control: no-store');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (is_https()) {
        header('Strict-Transport-Security: max-age=31536000');
    }
}

function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $idle = max(5, (int) cfg('session_idle_minutes', 480)) * 60;

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) $idle);
    // Separate cookie per environment so a local session never mixes with a live one.
    session_name('ledger_sid_' . app_env());
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();

    if (isset($_SESSION['last_seen']) && time() - (int) $_SESSION['last_seen'] > $idle) {
        destroy_session();
        session_start();
    }
    $_SESSION['last_seen'] = time();
}

function destroy_session(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 3600,
            'path'     => $p['path'],
            'domain'   => $p['domain'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'] ?? 'Strict',
        ]);
    }
    session_destroy();
}

/* ------------------------------------------------------------------ */
/* CSRF protection for every form that changes data                   */
/* ------------------------------------------------------------------ */

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf'];
}



/* ------------------------------------------------------------------ */
/* The built-in account (there is no sign-in)                          */
/* ------------------------------------------------------------------ */

/** The built-in account. There is no sign-in: the first visit creates it and every request uses it. */
function current_user(): ?array
{
    if (empty($_SESSION['uid'])) {
        $id = (int) scalar('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1');
        if ($id === 0) {
            db()->prepare('INSERT INTO users (full_name, username, password_hash) VALUES (?, ?, ?)')
                ->execute(['Admin', 'admin', password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT)]);
            $id = (int) db()->lastInsertId();
        }
        $_SESSION['uid'] = $id;
    }

    static $user = null;
    if ($user === null || (int) $user['id'] !== (int) $_SESSION['uid']) {
        $st = db()->prepare('SELECT id, username, full_name FROM users WHERE id = ? AND is_active = 1');
        $st->execute([(int) $_SESSION['uid']]);
        $user = $st->fetch() ?: null;
    }
    return $user;
}


/* ------------------------------------------------------------------ */
/* Audit trail                                                       */
/* ------------------------------------------------------------------ */

/** Record who did what. Call it after every change to orders, payments, customers and so on. */
function audit(string $action, ?string $entity = null, ?int $entityId = null, ?string $details = null): void
{
    $uid = isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : null;
    $st = db()->prepare(
        'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $st->execute([$uid, $action, $entity, $entityId, $details, client_ip()]);
}

/** 8425000 paise -> "₹84,250". Indian digit grouping. Shows paise only when not zero. */
function inr(int $paise): string
{
    $negative = $paise < 0;
    $abs = abs($paise);
    $rupees = (string) intdiv($abs, 100);
    $rem = $abs % 100;

    if (strlen($rupees) > 3) {
        $last3 = substr($rupees, -3);
        $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', substr($rupees, 0, -3));
        $rupees = $rest . ',' . $last3;
    }
    if ($rem !== 0) {
        $rupees .= '.' . str_pad((string) $rem, 2, '0', STR_PAD_LEFT);
    }
    return ($negative ? '-' : '') . '₹' . $rupees;
}

/* ================================================================== *
 * 3. ORDERS, PAYMENTS, LEDGER and the endpoints                      *
 * ================================================================== */

const SELF_COURIER = 'Self delivery';
const MAX_PAISE = 1000000000000; // 10,000,000,000 rupees. Stops typos like an extra 8 zeros.

/** Net amount of a payments row: money in is positive, refunds negative. */
const SQL_NET = "CASE WHEN type = 'received' THEN amount_paise ELSE -amount_paise END";

/** LEFT JOIN that adds pp.paid (net payments linked to each order). Alias the orders table as o. */
/** Profit of order `o` in SQL (same rule as order_profit()): NULL when any item has no purchase price. */
const SQL_ORDER_PROFIT = "(SELECT CASE WHEN SUM(oi.cost_paise IS NULL) > 0 THEN NULL
                                      ELSE SUM(oi.amount_paise - oi.qty * oi.cost_paise) - o.discount_paise END
                           FROM order_items oi WHERE oi.order_id = o.id)";
const SQL_ORDER_PAID_JOIN = "LEFT JOIN (SELECT order_id, SUM(CASE WHEN type = 'received' THEN amount_paise ELSE -amount_paise END) AS paid
    FROM payments WHERE voided_at IS NULL AND order_id IS NOT NULL GROUP BY order_id) pp ON pp.order_id = o.id";

/** Customer balance expression. Positive = customer owes you. Alias the customers table as c. */
const SQL_CUST_BALANCE = "(c.opening_paise
    + COALESCE((SELECT SUM(o2.total_paise) FROM orders o2 WHERE o2.customer_id = c.id AND o2.status = 'active'), 0)
    - COALESCE((SELECT SUM(CASE WHEN p2.type = 'received' THEN p2.amount_paise ELSE -p2.amount_paise END)
                FROM payments p2 WHERE p2.customer_id = c.id AND p2.voided_at IS NULL), 0))";

/* ------------------------------------------------------------------ */
/* Errors and JSON output                                             */
/* ------------------------------------------------------------------ */

class ApiError extends RuntimeException
{
    public function __construct(string $message, public int $status = 400)
    {
        parent::__construct($message);
    }
}

function fail(string $message, int $status = 400): never
{
    throw new ApiError($message, $status);
}

function json_out(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function json_ok(mixed $data = null): never
{
    json_out(['ok' => true, 'data' => $data]);
}

function json_fail(string $message, int $status = 400): never
{
    json_out(['ok' => false, 'error' => $message], $status);
}

/**
 * Start every endpoint with this. Handles session, error output and CSRF.
 * Returns the built-in account (there is no sign-in).
 */
function api_boot(bool $login = true): ?array
{
    boot();
    header('Content-Type: application/json; charset=utf-8');

    set_exception_handler(static function (Throwable $e): void {
        if ($e instanceof ApiError) {
            json_fail($e->getMessage(), $e->status);
        }
        error_log('API error: ' . get_class($e) . ' ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        $msg = 'Something went wrong. Please try again.';
        if (app_env() === 'test') {
            $msg .= ' [' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() . ']';
        }
        json_fail($msg, 500);
    });

    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if (!in_array($method, ['GET', 'POST'], true)) {
        json_fail('Method not allowed.', 405);
    }

    $user = current_user();
    if ($login && $user === null) {
        json_fail('Please sign in.', 401);
    }

    if ($method === 'POST') {
        $type = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
        if (!str_starts_with($type, 'application/json')) {
            json_fail('Bad request.', 415);
        }
        if (!hash_equals(csrf_token(), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
            json_fail('This page expired. Refresh it and try again.', 419);
        }
    }
    return $user;
}

/* ------------------------------------------------------------------ */
/* Reading input                                                      */
/* ------------------------------------------------------------------ */

/** The decoded JSON body of a POST request. */
function body(): array
{
    static $data = null;
    if ($data === null) {
        $raw = (string) file_get_contents('php://input');
        if (strlen($raw) > 1000000) {
            fail('Request is too large.', 413);
        }
        $data = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($data)) {
            fail('Invalid request.');
        }
    }
    return $data;
}

function clean_text(string $v): string
{
    return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? $v;
}

function in_str(array $a, string $key, int $max = 255, bool $required = false, string $label = ''): string
{
    $label = $label !== '' ? $label : $key;
    $v = $a[$key] ?? '';
    if (is_array($v)) {
        fail("$label is invalid.");
    }
    $v = clean_text(trim((string) $v));
    if ($required && $v === '') {
        fail("$label is required.");
    }
    if (mb_strlen($v) > $max) {
        fail("$label is too long (max $max characters).");
    }
    return $v;
}

function in_int(array $a, string $key, int $min, int $max, string $label = '', ?int $default = null): int
{
    $label = $label !== '' ? $label : $key;
    $v = $a[$key] ?? null;
    if (($v === null || $v === '') && $default !== null) {
        return $default;
    }
    if (is_string($v) && preg_match('/^-?\d{1,18}$/', $v)) {
        $v = (int) $v;
    }
    if (!is_int($v)) {
        fail("$label must be a whole number.");
    }
    if ($v < $min || $v > $max) {
        fail("$label must be between $min and $max.");
    }
    return $v;
}

/** A required record id chosen from a list. Shows "Choose X." when it is missing. */
function in_id(array $a, string $key, string $label): int
{
    $v = $a[$key] ?? null;
    if (is_string($v) && preg_match('/^\d{1,12}$/', $v)) {
        $v = (int) $v;
    }
    if (!is_int($v) || $v < 1) {
        fail("Choose $label.");
    }
    return $v;
}

/** Money in whole paise. */
function in_paise(array $a, string $key, string $label = '', bool $optional = false): int
{
    return in_int($a, $key, 0, MAX_PAISE, $label !== '' ? $label : $key, $optional ? 0 : null);
}

function in_enum(array $a, string $key, array $allowed, string $label = '', ?string $default = null): string
{
    $v = $a[$key] ?? null;
    if (($v === null || $v === '') && $default !== null) {
        return $default;
    }
    if (!is_string($v) || !in_array($v, $allowed, true)) {
        fail(($label !== '' ? $label : $key) . ' is invalid.');
    }
    return $v;
}

function valid_date(string $v): bool
{
    return (bool) preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

function in_date(array $a, string $key, string $label = '', bool $required = false): ?string
{
    $label = $label !== '' ? $label : $key;
    $v = trim((string) ($a[$key] ?? ''));
    if ($v === '') {
        if ($required) {
            fail("$label is required.");
        }
        return null;
    }
    if (!valid_date($v)) {
        fail("$label is not a valid date.");
    }
    return $v;
}

/** Query-string helpers for GET requests. */
function qs(string $key, int $max = 100): string
{
    $v = $_GET[$key] ?? '';
    return is_string($v) ? mb_substr(clean_text(trim($v)), 0, $max) : '';
}

function qint(string $key, int $default = 0): int
{
    $v = $_GET[$key] ?? null;
    return (is_string($v) && preg_match('/^\d{1,12}$/', $v)) ? (int) $v : $default;
}

function qdate(string $key): ?string
{
    $v = qs($key, 10);
    return valid_date($v) ? $v : null;
}

/** LIKE pattern that treats the user's text literally. */
function like(string $s): string
{
    return '%' . addcslashes($s, '\\%_') . '%';
}

/** [page, per, offset] from ?page= and ?per=. */
function page_params(int $defaultPer = 25, int $maxPer = 100): array
{
    $page = max(1, qint('page', 1));
    $per = min($maxPer, max(1, qint('per', $defaultPer)));
    return [$page, $per, ($page - 1) * $per];
}

/** Digits only; drops a leading 91 or 0. Returns '' when it does not look like a phone number. */
function norm_phone(string $raw): string
{
    $d = preg_replace('/\D+/', '', $raw) ?? '';
    if (strlen($d) === 12 && str_starts_with($d, '91')) {
        $d = substr($d, 2);
    } elseif (strlen($d) === 11 && $d[0] === '0') {
        $d = substr($d, 1);
    }
    return (strlen($d) >= 10 && strlen($d) <= 15) ? $d : '';
}

function today(): string
{
    return date('Y-m-d');
}

/** Run a query and return every row. */
function rows(string $sql, array $params = []): array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

/** Run a query and return one row, or null. */
function row(string $sql, array $params = []): ?array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    $r = $st->fetch();
    return $r === false ? null : $r;
}

/** Run a query and return the first column of the first row. */
function scalar(string $sql, array $params = []): mixed
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->fetchColumn();
}

/** Run $fn inside a transaction (joins one that is already open). */
function in_transaction(callable $fn): mixed
{
    $pdo = db();
    if ($pdo->inTransaction()) {
        return $fn();
    }
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

/* ------------------------------------------------------------------ */
/* Settings and counters                                              */
/* ------------------------------------------------------------------ */

function settings_all(): array
{
    $out = [];
    foreach (rows('SELECT k, v FROM settings') as $r) {
        $out[$r['k']] = (string) $r['v'];
    }
    // Business details typed into the SETTINGS block at the top of api.php win over the saved ones.
    foreach ((SETTINGS['business'] ?? []) as $k => $v) {
        if (is_string($v) && trim($v) !== '') {
            $out[$k] = str_replace('\\n', "\n", $v);
        }
    }
    return $out;
}

/** Next number for 'order' or 'invoice'. Runs inside the caller's transaction so a failed save wastes no number. */
function order_number(int $n): string
{
    return (string) cfg('order_prefix', 'OG') . str_pad((string) $n, (int) cfg('order_digits', 2), '0', STR_PAD_LEFT);
}

function next_counter(string $name): int
{
    $st = db()->prepare('UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = ?');
    $st->execute([$name]);
    if ($st->rowCount() !== 1) {
        throw new RuntimeException('Counter missing: ' . $name);
    }
    return (int) db()->query('SELECT LAST_INSERT_ID()')->fetchColumn();
}

/* ------------------------------------------------------------------ */
/* Customers                                                          */
/* ------------------------------------------------------------------ */

function customer_balance(int $customerId): int
{
    return (int) scalar('SELECT ' . SQL_CUST_BALANCE . ' FROM customers c WHERE c.id = ?', [$customerId]);
}

/**
 * Find a customer by id, else by phone number, else create one. Never creates a duplicate phone.
 * $c keys: id, name, phone, city, pincode, address.
 */
function resolve_customer(array $c): int
{
    $id = isset($c['id']) && is_numeric($c['id']) ? (int) $c['id'] : 0;
    if ($id > 0) {
        if (!scalar('SELECT id FROM customers WHERE id = ?', [$id])) {
            fail('Customer not found.', 404);
        }
        return $id;
    }

    $phone = norm_phone(in_str($c, 'phone', 20, true, 'Customer phone'));
    if ($phone === '') {
        fail('Enter a valid phone number (10 digits).');
    }
    $existing = scalar('SELECT id FROM customers WHERE phone = ?', [$phone]);
    if ($existing) {
        return (int) $existing;
    }

    $st = db()->prepare('INSERT INTO customers (name, phone, city, pincode, address) VALUES (?, ?, ?, ?, ?)');
    $st->execute([
        in_str($c, 'name', 120, true, 'Customer name'),
        $phone,
        in_str($c, 'city', 60),
        in_str($c, 'pincode', 10),
        in_str($c, 'address', 255),
    ]);
    $newId = (int) db()->lastInsertId();
    audit('customer_created', 'customer', $newId);
    return $newId;
}

/**
 * Ledger rows for one customer, oldest first, with a running balance.
 * debit = customer owes more, credit = customer paid.
 */
function customer_ledger(int $customerId): array
{
    $c = row('SELECT opening_paise, created_at FROM customers WHERE id = ?', [$customerId]);
    if (!$c) {
        return [];
    }

    $entries = [];
    if ((int) $c['opening_paise'] !== 0) {
        $entries[] = [
            'date' => substr((string) $c['created_at'], 0, 10), 'sort' => 0, 'id' => 0, 'kind' => 'opening',
            'text' => 'Opening balance', 'account' => '', 'ref' => '', 'order_id' => null, 'order_no' => '',
            'debit' => max(0, (int) $c['opening_paise']), 'credit' => max(0, -(int) $c['opening_paise']),
        ];
    }

    foreach (rows("SELECT id, order_no, order_date, total_paise, pay_plan FROM orders
                   WHERE customer_id = ? AND status = 'active'", [$customerId]) as $o) {
        $entries[] = [
            'date' => $o['order_date'], 'sort' => 1, 'id' => (int) $o['id'], 'kind' => 'order',
            'text' => 'Order ' . $o['order_no'], 'account' => '', 'ref' => '', 'order_id' => (int) $o['id'],
            'order_no' => $o['order_no'], 'plan' => $o['pay_plan'], 'debit' => (int) $o['total_paise'], 'credit' => 0,
        ];
    }

    foreach (rows("SELECT p.id, p.type, p.purpose, p.amount_paise, p.method, p.reference, p.received_on, p.order_id,
                          a.name AS account_name, o.order_no
                   FROM payments p
                   JOIN accounts a ON a.id = p.account_id
                   LEFT JOIN orders o ON o.id = p.order_id
                   WHERE p.customer_id = ? AND p.voided_at IS NULL", [$customerId]) as $p) {
        $refund = $p['type'] === 'refund';
        $entries[] = [
            'date' => $p['received_on'], 'sort' => 2, 'id' => (int) $p['id'], 'kind' => $refund ? 'refund' : 'payment',
            'text' => $refund ? 'Refund paid' : 'Payment received', 'purpose' => $p['purpose'],
            'method' => $p['method'], 'account' => $p['account_name'], 'ref' => $p['reference'],
            'order_id' => $p['order_id'] !== null ? (int) $p['order_id'] : null, 'order_no' => (string) ($p['order_no'] ?? ''),
            'debit' => $refund ? (int) $p['amount_paise'] : 0, 'credit' => $refund ? 0 : (int) $p['amount_paise'],
        ];
    }

    usort($entries, static fn(array $a, array $b): int => [$a['date'], $a['sort'], $a['id']] <=> [$b['date'], $b['sort'], $b['id']]);

    $bal = 0;
    foreach ($entries as &$e) {
        $bal += $e['debit'] - $e['credit'];
        $e['balance'] = $bal;
    }
    unset($e);
    return $entries;
}

/* ------------------------------------------------------------------ */
/* Orders                                                             */
/* ------------------------------------------------------------------ */

/** Validate order lines and compute their amounts. Never trusts totals from the browser. */
/** A product photo reference: one uploaded here (uploads/xxxx.jpg) or an https link from the catalog. */
function in_image(mixed $v): string
{
    $v = trim((string) $v);
    if ($v === '') {
        return '';
    }
    if (preg_match('#^uploads/[a-f0-9]{16,40}\.(jpg|png|webp)$#', $v) || (preg_match('#^https://[^\s"\'<>]+$#i', $v) && strlen($v) <= 255)) {
        return $v;
    }
    return '';
}

function normalize_items(mixed $raw): array
{
    if (!is_array($raw) || $raw === []) {
        fail('Add at least one item.');
    }
    if (count($raw) > 100) {
        fail('Too many items (max 100).');
    }

    $out = [];
    $n = 0;
    foreach (array_values($raw) as $row) {
        $n++;
        if (!is_array($row)) {
            fail("Item $n is invalid.");
        }
        $name = in_str($row, 'name', 160, true, "Item $n name");
        $qty = in_int($row, 'qty', 1, 100000, "Item $n quantity");
        $rate = in_paise($row, 'rate_paise', "Item $n rate");
        $gross = $qty * $rate;
        $costRaw = $row['cost_paise'] ?? null;
        $cost = ($costRaw === null || $costRaw === '') ? null : in_paise($row, 'cost_paise', "Item $n purchase price");
        $disc = in_paise($row, 'discount_paise', "Item $n discount", true);
        if ($disc > $gross) {
            fail("Item $n discount is more than the item amount.");
        }
        $pid = (isset($row['product_id']) && is_numeric($row['product_id']) && (int) $row['product_id'] > 0)
            ? (int) $row['product_id'] : null;
        $out[] = [
            'product_id' => $pid, 'name' => $name, 'qty' => $qty, 'rate_paise' => $rate, 'cost_paise' => $cost,
            'discount_paise' => $disc, 'amount_paise' => $gross - $disc, 'image' => in_image($row['image'] ?? ''),
        ];
    }
    return $out;
}

/**
 * Profit of an order from its items: what was sold (after item and order discount) minus what the items cost.
 * Shipping is left out. Returns null when any item has no purchase price, so a partial figure never looks real.
 * @return array{cost_paise:int,profit_paise:int,base_paise:int,pct:float}|null
 */
function order_profit(array $items, int $orderDiscount): ?array
{
    $cost = 0;
    $sold = 0;
    foreach ($items as $it) {
        if (!isset($it['cost_paise']) || $it['cost_paise'] === null) {
            return null;
        }
        $cost += (int) $it['qty'] * (int) $it['cost_paise'];
        $sold += (int) $it['amount_paise'];
    }
    $base = $sold - $orderDiscount;
    $profit = $base - $cost;
    return ['cost_paise' => $cost, 'profit_paise' => $profit, 'base_paise' => $base,
            'pct' => $base > 0 ? round($profit / $base * 100, 1) : 0.0];
}

function order_paid(int $orderId): int
{
    return (int) scalar('SELECT COALESCE(SUM(' . SQL_NET . '), 0) FROM payments WHERE order_id = ? AND voided_at IS NULL', [$orderId]);
}

/** Full order record with customer, items, payments and shipments. Null when not found. */
function get_order_full(int $id): ?array
{
    $o = row('SELECT o.*, c.name AS c_name, c.phone AS c_phone, c.city AS c_city, c.pincode AS c_pincode,
                     c.address AS c_address, COALESCE(pp.paid, 0) AS paid
              FROM orders o
              JOIN customers c ON c.id = o.customer_id ' . SQL_ORDER_PAID_JOIN . '
              WHERE o.id = ?', [$id]);
    if (!$o) {
        return null;
    }

    $items = rows('SELECT product_id, name, qty, rate_paise, cost_paise, discount_paise, amount_paise, image
                   FROM order_items WHERE order_id = ? ORDER BY position, id', [$id]);
    foreach ($items as &$it) {
        $it['product_id'] = $it['product_id'] !== null ? (int) $it['product_id'] : null;
        $it['cost_paise'] = $it['cost_paise'] !== null ? (int) $it['cost_paise'] : null;
    }
    unset($it);

    $payments = rows('SELECT p.id, p.type, p.purpose, p.amount_paise, p.method, p.reference, p.received_on, p.note,
                             p.voided_at, p.void_reason, p.account_id, a.name AS account_name
                      FROM payments p JOIN accounts a ON a.id = p.account_id
                      WHERE p.order_id = ? ORDER BY p.received_on, p.id', [$id]);

    $shipments = array_map('ship_out', rows('SELECT id, courier, tracking_id, status, packed_on, dispatched_on, delivered_on, note,
                       length_cm, breadth_cm, height_cm, weight_g
                       FROM shipments WHERE order_id = ? ORDER BY id', [$id]));

    $paid = (int) $o['paid'];
    $total = (int) $o['total_paise'];
    return [
        'id' => (int) $o['id'], 'order_no' => $o['order_no'], 'order_date' => $o['order_date'],
        'due_date' => $o['due_date'], 'status' => $o['status'], 'pay_plan' => $o['pay_plan'], 'source' => $o['source'],
        'salesperson' => (string) $o['salesperson'], 'profit' => order_profit($items, (int) $o['discount_paise']),
        'subtotal_paise' => (int) $o['subtotal_paise'], 'discount_paise' => (int) $o['discount_paise'],
        'shipping_paise' => (int) $o['shipping_paise'], 'total_paise' => $total,
        'paid_paise' => $paid, 'balance_paise' => $o['status'] === 'active' ? $total - $paid : 0,
        'ship_address' => $o['ship_address'], 'ship_city' => $o['ship_city'], 'ship_pincode' => $o['ship_pincode'],
        'notes' => $o['notes'], 'invoice_no' => $o['invoice_no'], 'invoice_date' => $o['invoice_date'],
        'cancel_reason' => $o['cancel_reason'], 'created_at' => $o['created_at'],
        'customer' => [
            'id' => (int) $o['customer_id'], 'name' => $o['c_name'], 'phone' => $o['c_phone'], 'city' => $o['c_city'],
            'pincode' => $o['c_pincode'], 'address' => $o['c_address'],
            'balance_paise' => customer_balance((int) $o['customer_id']),
        ],
        'items' => $items, 'payments' => $payments, 'shipments' => $shipments,
    ];
}

/** Clean a tracking ID. Letters, numbers and - _ / only. Empty is allowed. */
function clean_tracking(string $raw): string
{
    $t = strtoupper(preg_replace('/\s+/', '', $raw) ?? '');
    if ($t !== '' && !preg_match('/^[A-Z0-9\-_\/]{3,60}$/', $t)) {
        fail('Tracking ID can use only letters, numbers and - _ / (3 to 60 characters).');
    }
    return $t;
}

/** One parcel measurement in cm. Not sent = keep what is saved; empty = clear it. */
function ship_dim(array $a, string $key, string $label, $old)
{
    if (!array_key_exists($key, $a)) {
        return $old;
    }
    $v = $a[$key];
    if ($v === null || (is_string($v) && trim($v) === '')) {
        return null;
    }
    $v = is_string($v) ? str_replace(',', '.', trim($v)) : $v;
    if (is_array($v) || !is_numeric($v)) {
        fail("$label must be a number.");
    }
    $n = round((float) $v, 1);
    if ($n < 0.1 || $n > 500) {
        fail("$label must be between 0.1 and 500 cm.");
    }
    return $n;
}

/** Parcel size and weight from a request: [length_cm, breadth_cm, height_cm, weight_g]. */
function ship_size(array $a, ?array $old = null): array
{
    $l = ship_dim($a, 'length_cm', 'Length', $old['length_cm'] ?? null);
    $b = ship_dim($a, 'breadth_cm', 'Breadth', $old['breadth_cm'] ?? null);
    $h = ship_dim($a, 'height_cm', 'Height', $old['height_cm'] ?? null);
    $w = $old['weight_g'] ?? null;
    if (array_key_exists('weight_kg', $a)) {
        $v = $a['weight_kg'];
        if ($v === null || (is_string($v) && trim($v) === '')) {
            $w = null;
        } else {
            $v = is_string($v) ? str_replace(',', '.', trim($v)) : $v;
            if (is_array($v) || !is_numeric($v)) {
                fail('Weight must be a number of kg.');
            }
            $kg = (float) $v;
            if ($kg < 0.01 || $kg > 1000) {
                fail('Weight must be between 0.01 and 1000 kg.');
            }
            $w = (int) round($kg * 1000);
        }
    }
    return [$l, $b, $h, $w];
}

/** Shipment row for the browser: numbers as numbers, weight in kg. */
function ship_out(array $s): array
{
    foreach (['length_cm', 'breadth_cm', 'height_cm'] as $k) {
        $s[$k] = isset($s[$k]) && $s[$k] !== null ? (float) $s[$k] : null;
    }
    $s['weight_kg'] = isset($s['weight_g']) && $s['weight_g'] !== null ? round((int) $s['weight_g'] / 1000, 3) : null;
    unset($s['weight_g']);
    return $s;
}

/** Stops the same tracking ID being saved on two shipments. */
function assert_tracking_free(string $tracking, int $exceptShipmentId = 0): void
{
    if ($tracking === '') {
        return;
    }
    $hit = row('SELECT s.id, o.order_no FROM shipments s JOIN orders o ON o.id = s.order_id
                WHERE s.tracking_id = ? AND s.id <> ? LIMIT 1', [$tracking, $exceptShipmentId]);
    if ($hit) {
        fail('Tracking ID ' . $tracking . ' is already saved on order ' . $hit['order_no'] . '.', 409);
    }
}

/* ------------------------------------------------------------------ */
/* Payments                                                           */
/* ------------------------------------------------------------------ */

const PAYMENT_METHODS = ['upi', 'bank_transfer', 'cash', 'cheque', 'card', 'wallet', 'other'];

/** prepaid = whole amount at once, advance = first partial payment, balance = a later payment, cod = cash on delivery. */
function payment_purpose(int $orderId, string $plan, int $total, int $amount): string
{
    if ($plan === 'cod') {
        return 'cod';
    }
    $prior = (int) scalar("SELECT COUNT(*) FROM payments WHERE order_id = ? AND type = 'received' AND voided_at IS NULL", [$orderId]);
    if ($prior === 0) {
        return $amount >= $total ? 'prepaid' : 'advance';
    }
    return 'balance';
}

/**
 * Save a payment or refund.
 * $in keys: customer_id, order_id (int|null), type, amount_paise, method, account_id, reference, received_on, note.
 * With no order_id, a received payment is applied to the customer's oldest unpaid orders first;
 * anything left over is kept as an on-account credit.
 * Returns ['ids' => [...], 'applied' => [['order_no', 'amount_paise'], ...], 'on_account_paise' => n].
 */
function record_payment(array $in, ?int $userId): array
{
    return in_transaction(static function () use ($in, $userId): array {
        $pdo = db();
        $amount = (int) $in['amount_paise'];
        if ($amount <= 0) {
            fail('Enter an amount greater than zero.');
        }
        if (!scalar('SELECT id FROM accounts WHERE id = ? AND is_active = 1', [$in['account_id']])) {
            fail('Choose the account that received this money.');
        }
        // Locking the customer row makes two payments for one customer run one after the other.
        if (!scalar('SELECT id FROM customers WHERE id = ? FOR UPDATE', [$in['customer_id']])) {
            fail('Customer not found.', 404);
        }

        $insert = static function (?int $orderId, int $amt, string $purpose) use ($pdo, $in, $userId): int {
            $st = $pdo->prepare('INSERT INTO payments
                (customer_id, order_id, type, purpose, amount_paise, method, account_id, reference, received_on, note, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $st->execute([
                $in['customer_id'], $orderId, $in['type'], $purpose, $amt, $in['method'], $in['account_id'],
                $in['reference'], $in['received_on'], $in['note'], $userId,
            ]);
            return (int) $pdo->lastInsertId();
        };

        $ids = [];
        $applied = [];
        $onAccount = 0;
        $orderId = $in['order_id'] !== null ? (int) $in['order_id'] : null;

        $order = null;
        if ($orderId !== null) {
            $order = row('SELECT id, order_no, customer_id, status, total_paise, pay_plan FROM orders WHERE id = ?', [$orderId]);
            if (!$order || (int) $order['customer_id'] !== (int) $in['customer_id']) {
                fail('That order does not belong to this customer.');
            }
        }

        if ($in['type'] === 'refund') {
            if ($order && $amount > order_paid($orderId)) {
                fail('Refund is more than the ' . inr(order_paid($orderId)) . ' paid on this order.');
            }
            $ids[] = $insert($orderId, $amount, 'refund');
        } elseif ($order) {
            if ($order['status'] !== 'active') {
                fail('This order is cancelled.');
            }
            $balance = (int) $order['total_paise'] - order_paid($orderId);
            if ($balance <= 0) {
                fail('This order is already fully paid.');
            }
            if ($amount > $balance) {
                fail('That is more than the order balance of ' . inr($balance)
                    . '. Record it against the customer (no order) to spread it over older orders.');
            }
            $ids[] = $insert($orderId, $amount, payment_purpose($orderId, (string) $order['pay_plan'], (int) $order['total_paise'], $amount));
            $applied[] = ['order_no' => $order['order_no'], 'amount_paise' => $amount];
        } else {
            $left = $amount;
            $open = rows("SELECT o.id, o.order_no, o.total_paise, o.pay_plan, COALESCE(pp.paid, 0) AS paid
                          FROM orders o " . SQL_ORDER_PAID_JOIN . "
                          WHERE o.customer_id = ? AND o.status = 'active'
                          ORDER BY o.order_date, o.id", [$in['customer_id']]);
            foreach ($open as $o) {
                $bal = (int) $o['total_paise'] - (int) $o['paid'];
                if ($left <= 0) {
                    break;
                }
                if ($bal <= 0) {
                    continue;
                }
                $part = min($left, $bal);
                $ids[] = $insert((int) $o['id'], $part, payment_purpose((int) $o['id'], (string) $o['pay_plan'], (int) $o['total_paise'], $part));
                $applied[] = ['order_no' => $o['order_no'], 'amount_paise' => $part];
                $left -= $part;
            }
            if ($left > 0) {
                $ids[] = $insert(null, $left, 'on_account');
                $onAccount = $left;
            }
        }

        foreach ($ids as $pid) {
            audit($in['type'] === 'refund' ? 'refund_recorded' : 'payment_recorded', 'payment', $pid,
                inr((int) scalar('SELECT amount_paise FROM payments WHERE id = ?', [$pid])));
        }
        return ['ids' => $ids, 'applied' => $applied, 'on_account_paise' => $onAccount];
    });
}

/** Validate a payment form (from JSON) into the shape record_payment() expects. */
/** The account a name was typed for: found by name (any letter case), or created on the spot. */
function account_by_name(string $name): int
{
    $name = trim($name);
    $id = scalar('SELECT id FROM accounts WHERE name = ? LIMIT 1', [$name]);
    if ($id) {
        db()->prepare('UPDATE accounts SET is_active = 1 WHERE id = ?')->execute([(int) $id]);
        return (int) $id;
    }
    db()->prepare("INSERT INTO accounts (name, type, opening_paise, is_active) VALUES (?, 'other', 0, 1)")->execute([$name]);
    $new = (int) db()->lastInsertId();
    audit('account_created', 'account', $new, $name);
    return $new;
}

function parse_payment_input(array $a, ?int $customerId = null, ?int $orderId = null): array
{
    $cid = $customerId ?? in_id($a, 'customer_id', 'a customer');
    $oid = $orderId;
    if ($oid === null && isset($a['order_id']) && $a['order_id'] !== '' && $a['order_id'] !== null) {
        $oid = in_id($a, 'order_id', 'an order');
    }
    return [
        'customer_id' => $cid,
        'order_id' => $oid,
        'type' => in_enum($a, 'type', ['received', 'refund'], 'Payment type', 'received'),
        'amount_paise' => in_paise($a, 'amount_paise', 'Amount'),
        'method' => in_enum($a, 'method', PAYMENT_METHODS, 'Payment method', 'upi'),
        'account_id' => in_str($a, 'account_name', 60) !== ''
            ? account_by_name(in_str($a, 'account_name', 60))
            : in_id($a, 'account_id', 'the account that received the money'),
        'reference' => in_str($a, 'reference', 80),
        'received_on' => in_date($a, 'received_on', 'Payment date', true),
        'note' => in_str($a, 'note', 200),
    ];
}

/* ------------------------------------------------------------------ */
/* Shipments                                                          */
/* ------------------------------------------------------------------ */

const SHIPMENT_STATUSES = ['pending', 'packed', 'dispatched', 'delivered', 'returned'];

/** Fills packed/dispatched/delivered dates automatically when the status moves forward. Returns [packed, dispatched, delivered]. */
function shipment_dates(string $status, array $current = []): array
{
    $t = today();
    $packed = $current['packed_on'] ?? null;
    $dispatched = $current['dispatched_on'] ?? null;
    $delivered = $current['delivered_on'] ?? null;
    if (in_array($status, ['packed', 'dispatched', 'delivered'], true) && !$packed) {
        $packed = $t;
    }
    if (in_array($status, ['dispatched', 'delivered'], true) && !$dispatched) {
        $dispatched = $t;
    }
    if ($status === 'delivered' && !$delivered) {
        $delivered = $t;
    }
    return [$packed, $dispatched, $delivered];
}

/** SQL condition for "this shipment still needs a tracking ID". Alias shipments as s. */
const SQL_NEEDS_TRACKING = "s.tracking_id = '' AND s.status IN ('pending','packed','dispatched') AND s.courier <> 'Self delivery'";

function me_payload(?array $user): array
{
    return [
        'user' => $user,
        'csrf' => csrf_token(),
        'env' => app_env(),
        'app_name' => (string) cfg('app_name', 'Order Ledger'),
        'today' => today(),
        'back_url' => (string) cfg('back_url', ''),
        'catalog_api' => (string) cfg('catalog_api', ''),
    ];
}

function ep_auth(): void
{
    $user = api_boot();
    json_ok(me_payload($user));
}



function ep_dashboard(): void
{
    api_boot();

    $today = today();
    $monthStart = date('Y-m-01');
    $monthEnd = date('Y-m-t');

    $m = row("SELECT COALESCE(SUM(total_paise), 0) AS s, COUNT(*) AS n FROM orders
              WHERE status = 'active' AND order_date BETWEEN ? AND ?", [$monthStart, $monthEnd]);
    $t = row("SELECT COALESCE(SUM(total_paise), 0) AS s, COUNT(*) AS n FROM orders
              WHERE status = 'active' AND order_date = ?", [$today]);
    $collected = (int) scalar('SELECT COALESCE(SUM(' . SQL_NET . '), 0) FROM payments
                               WHERE voided_at IS NULL AND received_on BETWEEN ? AND ?', [$monthStart, $monthEnd]);
    $owing = row('SELECT COALESCE(SUM(bal), 0) AS total, COUNT(*) AS n FROM (
                    SELECT ' . SQL_CUST_BALANCE . ' AS bal FROM customers c) t WHERE bal > 0');

    // Orders that still have a balance, oldest due date first.
    $unpaidSql = " FROM orders o JOIN customers c ON c.id = o.customer_id " . SQL_ORDER_PAID_JOIN . "
                   WHERE o.status = 'active' AND o.total_paise - COALESCE(pp.paid, 0) > 0";
    $unpaid = rows("SELECT o.id, o.order_no, o.order_date, o.due_date, c.name,
                           o.total_paise - COALESCE(pp.paid, 0) AS balance_paise" . $unpaidSql . "
                    ORDER BY (o.due_date IS NULL), o.due_date, o.order_date, o.id LIMIT 6");
    $unpaidCount = (int) scalar('SELECT COUNT(*)' . $unpaidSql);
    $overdueCount = (int) scalar('SELECT COUNT(*)' . $unpaidSql . ' AND o.due_date IS NOT NULL AND o.due_date < ?', [$today]);

    $trackSql = " FROM shipments s JOIN orders o ON o.id = s.order_id JOIN customers c ON c.id = o.customer_id
                  WHERE o.status = 'active' AND " . SQL_NEEDS_TRACKING;
    $noTrack = rows("SELECT s.id AS shipment_id, s.status, s.packed_on, o.id AS order_id, o.order_no, o.order_date, c.name" . $trackSql . "
                     ORDER BY o.order_date, o.id LIMIT 6");
    $noTrackCount = (int) scalar('SELECT COUNT(*)' . $trackSql);

    $payments = rows("SELECT p.id, p.type, p.purpose, p.amount_paise, p.received_on, p.created_at, c.name, a.name AS account_name
                      FROM payments p JOIN customers c ON c.id = p.customer_id JOIN accounts a ON a.id = p.account_id
                      WHERE p.voided_at IS NULL ORDER BY p.id DESC LIMIT 6");

    $byDay = [];
    foreach (rows("SELECT order_date, SUM(total_paise) AS s FROM orders
                   WHERE status = 'active' AND order_date >= ? AND order_date <= ? GROUP BY order_date",
                  [date('Y-m-d', strtotime('-6 day')), $today]) as $r) {
        $byDay[$r['order_date']] = (int) $r['s'];
    }
    $days = [];
    for ($i = 6; $i >= 0; $i--) {
        $d = date('Y-m-d', strtotime("-$i day"));
        $days[] = ['date' => $d, 'amount_paise' => $byDay[$d] ?? 0];
    }

    json_ok([
        'today' => $today,
        'kpis' => [
            'billed_month' => (int) $m['s'], 'orders_month' => (int) $m['n'],
            'collected_month' => $collected,
            'outstanding' => (int) $owing['total'], 'owing_customers' => (int) $owing['n'],
            'billed_today' => (int) $t['s'], 'orders_today' => (int) $t['n'],
        ],
        'unpaid' => $unpaid, 'unpaid_count' => $unpaidCount, 'overdue_count' => $overdueCount,
        'no_track' => $noTrack, 'no_track_count' => $noTrackCount,
        'payments' => $payments,
        'days' => $days,
    ]);
}

/** How much sits under this customer: used to warn before deleting. */
function customer_counts(int $id): array
{
    return [
        'orders' => (int) scalar('SELECT COUNT(*) FROM orders WHERE customer_id = ?', [$id]),
        'payments' => (int) scalar('SELECT COUNT(*) FROM payments WHERE customer_id = ?', [$id]),
    ];
}

function ep_customers(): void
{
    $user = api_boot();

    /* ------------------------------ Read ------------------------------ */

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $id = qint('id');

        if ($id > 0) {
            $c = row('SELECT id, name, phone, city, pincode, address, notes, opening_paise, created_at FROM customers WHERE id = ?', [$id]);
            if (!$c) {
                fail('Customer not found.', 404);
            }
            $sum = row("SELECT
                          COALESCE((SELECT SUM(total_paise) FROM orders WHERE customer_id = ? AND status = 'active'), 0) AS billed,
                          COALESCE((SELECT SUM(" . SQL_NET . ") FROM payments WHERE customer_id = ? AND voided_at IS NULL), 0) AS received,
                          (SELECT COUNT(*) FROM orders WHERE customer_id = ? AND status = 'active') AS orders_n", [$id, $id, $id]);
            $orders = rows("SELECT o.id, o.order_no, o.order_date, o.due_date, o.status, o.pay_plan, o.total_paise,
                                   COALESCE(pp.paid, 0) AS paid_paise,
                                   (SELECT s.tracking_id FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS tracking_id,
                                   (SELECT s.status FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS ship_status
                            FROM orders o " . SQL_ORDER_PAID_JOIN . "
                            WHERE o.customer_id = ? ORDER BY o.order_date DESC, o.id DESC LIMIT 200", [$id]);
            $c['opening_paise'] = (int) $c['opening_paise'];
            json_ok([
                'customer' => $c,
                'summary' => [
                    'billed_paise' => (int) $sum['billed'], 'received_paise' => (int) $sum['received'],
                    'balance_paise' => customer_balance($id) , 'orders' => (int) $sum['orders_n'],
                ],
                'ledger' => customer_ledger($id),
                'orders' => $orders,
            ]);
        }

        // List (also used for the customer search box on the order form).
        [$page, $per, $offset] = page_params(25, 100);
        $q = qs('q');
        $filter = qs('filter', 10);
        $sort = qs('sort', 10);

        $where = ['1 = 1'];
        $params = [];
        if ($q !== '') {
            $where[] = '(c.name LIKE ? OR c.phone LIKE ? OR c.city LIKE ?)';
            $lk = like($q);
            array_push($params, $lk, $lk, $lk);
        }
        $inner = "SELECT c.id, c.name, c.phone, c.city, c.pincode, c.address, c.notes, c.opening_paise,
                         " . SQL_CUST_BALANCE . " AS bal,
                         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'active') AS orders_n,
                         (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id AND o.status = 'active') AS last_order
                  FROM customers c WHERE " . implode(' AND ', $where);

        $cond = match ($filter) {
            'owes' => 'bal > 0', 'settled' => 'bal = 0', default => '1 = 1',
        };
        $order = match ($sort) {
            'balance' => 'bal DESC, name', 'recent' => 'last_order IS NULL, last_order DESC, name', default => 'name',
        };

        $tot = row("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN bal > 0 THEN bal ELSE 0 END), 0) AS owed
                    FROM ($inner) t WHERE $cond", $params);
        $list = rows("SELECT * FROM ($inner) t WHERE $cond ORDER BY $order, id LIMIT $per OFFSET $offset", $params);

        foreach ($list as &$r) {
            $r['id'] = (int) $r['id'];
            $r['bal'] = (int) $r['bal'];
            $r['opening_paise'] = (int) $r['opening_paise'];
            $r['orders_n'] = (int) $r['orders_n'];
        }
        unset($r);

        json_ok(['rows' => $list, 'total' => (int) $tot['n'], 'owed_paise' => (int) $tot['owed'], 'page' => $page, 'per' => $per]);
    }

    /* ------------------------------ Write ----------------------------- */

    $b = body();
    $action = in_str($b, 'action', 30);

    if ($action === 'save') {
        $id = isset($b['id']) && is_numeric($b['id']) ? (int) $b['id'] : 0;
        $name = in_str($b, 'name', 120, true, 'Name');
        $phone = norm_phone(in_str($b, 'phone', 20, true, 'Phone'));
        if ($phone === '') {
            fail('Enter a valid phone number (10 digits).');
        }
        $city = in_str($b, 'city', 60);
        $pin = in_str($b, 'pincode', 10);
        $address = in_str($b, 'address', 255);
        $notes = in_str($b, 'notes', 255);
        $opening = in_int($b, 'opening_paise', -MAX_PAISE, MAX_PAISE, 'Opening balance', 0);

        $clash = row('SELECT id, name FROM customers WHERE phone = ? AND id <> ?', [$phone, $id]);
        if ($clash) {
            fail('This phone number already belongs to ' . $clash['name'] . '.', 409);
        }

        if ($id > 0) {
            if (!scalar('SELECT id FROM customers WHERE id = ?', [$id])) {
                fail('Customer not found.', 404);
            }
            $st = db()->prepare('UPDATE customers SET name = ?, phone = ?, city = ?, pincode = ?, address = ?, notes = ?, opening_paise = ? WHERE id = ?');
            $st->execute([$name, $phone, $city, $pin, $address, $notes, $opening, $id]);
            audit('customer_updated', 'customer', $id);
        } else {
            $st = db()->prepare('INSERT INTO customers (name, phone, city, pincode, address, notes, opening_paise) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $st->execute([$name, $phone, $city, $pin, $address, $notes, $opening]);
            $id = (int) db()->lastInsertId();
            audit('customer_created', 'customer', $id);
        }
        json_ok(['id' => $id]);
    }


    if ($action === 'delete_info') {
        $id = in_id($b, 'id', 'a customer');
        if (!scalar('SELECT id FROM customers WHERE id = ?', [$id])) {
            fail('Customer not found.', 404);
        }
        json_ok(customer_counts($id));
    }

    // Deletes the customer together with their orders, shipments and payments.
    if ($action === 'delete') {
        $id = in_id($b, 'id', 'a customer');
        $c = row('SELECT id, name FROM customers WHERE id = ?', [$id]);
        if (!$c) {
            fail('Customer not found.', 404);
        }
        $n = customer_counts($id);
        in_transaction(function () use ($id): void {
            db()->prepare('DELETE FROM payments WHERE customer_id = ?')->execute([$id]);
            db()->prepare('DELETE FROM orders WHERE customer_id = ?')->execute([$id]);   // items and shipments go with them
            db()->prepare('DELETE FROM customers WHERE id = ?')->execute([$id]);
        });
        audit('customer_deleted', 'customer', $id, $c['name'] . ' with ' . $n['orders'] . ' orders and ' . $n['payments'] . ' payments');
        json_ok(true);
    }

    fail('Unknown action.');
}

/** Create or update an order. Returns [id, order_no]. */
function save_order(array $b, int $userId): array
{
    return in_transaction(static function () use ($b, $userId): array {
        $id = isset($b['id']) && is_numeric($b['id']) ? (int) $b['id'] : 0;

        $items = normalize_items($b['items'] ?? null);
        $subtotal = (int) array_sum(array_column($items, 'amount_paise'));
        $discount = in_paise($b, 'discount_paise', 'Discount', true);
        $shipping = in_paise($b, 'shipping_paise', 'Shipping charge', true);
        if ($discount > $subtotal) {
            fail('Discount is more than the items total.');
        }
        $total = $subtotal - $discount + $shipping;
        if ($total <= 0) {
            fail('Order total must be more than zero.');
        }
        if ($total > MAX_PAISE) {
            fail('Order total is too large.');
        }

        $date = in_date($b, 'order_date', 'Order date', true);
        $due = in_date($b, 'due_date', 'Due date');
        $plan = in_enum($b, 'pay_plan', ['prepaid', 'advance', 'cod', 'credit'], 'Payment type');
        $source = in_str($b, 'source', 30) ?: 'WhatsApp';
        $notes = in_str($b, 'notes', 500);
        $sales = in_str($b, 'salesperson', 60);
        if ($sales !== '') {
            db()->prepare('INSERT IGNORE INTO salesmen (name) VALUES (?)')->execute([$sales]);
        }
        $cust = is_array($b['customer'] ?? null) ? $b['customer'] : [];
        $shipAddr = in_str($cust, 'address', 255);
        $shipCity = in_str($cust, 'city', 60);
        $shipPin = in_str($cust, 'pincode', 10);

        if ($id > 0) {
            $o = row('SELECT id, status, order_no FROM orders WHERE id = ? FOR UPDATE', [$id]);
            if (!$o) {
                fail('Order not found.', 404);
            }
            if ($o['status'] !== 'active') {
                fail('This order is cancelled. Restore it before editing.');
            }
            $st = db()->prepare('UPDATE orders SET order_date = ?, due_date = ?, pay_plan = ?, source = ?, salesperson = ?,
                                 subtotal_paise = ?, discount_paise = ?, shipping_paise = ?, total_paise = ?,
                                 ship_address = ?, ship_city = ?, ship_pincode = ?, notes = ? WHERE id = ?');
            $st->execute([$date, $due, $plan, $source, $sales, $subtotal, $discount, $shipping, $total,
                          $shipAddr, $shipCity, $shipPin, $notes, $id]);
            db()->prepare('DELETE FROM order_items WHERE order_id = ?')->execute([$id]);
            $orderNo = (string) $o['order_no'];
            audit('order_updated', 'order', $id, $orderNo . ' total ' . inr($total));
        } else {
            $customerId = resolve_customer($cust);
            // If the customer has no address saved yet, keep the one typed on this order.
            db()->prepare("UPDATE customers SET address = ?, city = ?, pincode = ? WHERE id = ? AND address = ''")
                ->execute([$shipAddr, $shipCity, $shipPin, $customerId]);

            $orderNo = order_number(next_counter('order'));
            $st = db()->prepare('INSERT INTO orders (order_no, customer_id, order_date, pay_plan, source, salesperson,
                                 subtotal_paise, discount_paise, shipping_paise, total_paise, due_date,
                                 ship_address, ship_city, ship_pincode, notes, created_by)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $st->execute([$orderNo, $customerId, $date, $plan, $source, $sales, $subtotal, $discount, $shipping, $total,
                          $due, $shipAddr, $shipCity, $shipPin, $notes, $userId]);
            $id = (int) db()->lastInsertId();
            audit('order_created', 'order', $id, $orderNo . ' total ' . inr($total));

            // Every order starts with one shipment row so it shows up in "needs tracking ID".
            $sh = is_array($b['shipment'] ?? null) ? $b['shipment'] : [];
            $courier = in_str($sh, 'courier', 40);
            $tracking = clean_tracking(in_str($sh, 'tracking_id', 60));
            assert_tracking_free($tracking);
            $sStatus = in_enum($sh, 'status', SHIPMENT_STATUSES, 'Dispatch status', 'pending');
            [$packed, $dispatched, $delivered] = shipment_dates($sStatus);
            [$len, $bre, $hei, $wgt] = ship_size($sh);
            db()->prepare('INSERT INTO shipments (order_id, courier, tracking_id, status, packed_on, dispatched_on, delivered_on,
                           length_cm, breadth_cm, height_cm, weight_g)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $courier, $tracking, $sStatus, $packed, $dispatched, $delivered, $len, $bre, $hei, $wgt]);

            // Optional payment taken with the order (advance or full prepaid).
            $pay = is_array($b['payment'] ?? null) ? $b['payment'] : null;
            if ($pay !== null && (int) ($pay['amount_paise'] ?? 0) > 0) {
                $pay['received_on'] = $pay['received_on'] ?? today();
                $in = parse_payment_input($pay + ['type' => 'received'], $customerId, $id);
                if ($in['amount_paise'] > $total) {
                    fail('The payment is more than the order total.');
                }
                record_payment($in, $userId);
            }
        }

        $ins = db()->prepare('INSERT INTO order_items (order_id, position, product_id, name, qty, rate_paise, cost_paise, discount_paise, amount_paise, image)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($items as $i => $it) {
            $ins->execute([$id, $i, $it['product_id'], $it['name'], $it['qty'], $it['rate_paise'], $it['cost_paise'], $it['discount_paise'], $it['amount_paise'], $it['image']]);
        }
        return [$id, $orderNo];
    });
}

function ep_orders(): void
{
    $user = api_boot();
    $userId = (int) $user['id'];

    /* ------------------------------ Read ------------------------------ */

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        // Salesperson names used before, newest first (for the suggestions and the filter).
        if (qs('names', 2) === '1') {
            json_ok(array_map(static fn(array $r): string => (string) $r['name'],
                rows('SELECT name FROM salesmen ORDER BY name')));
        }
        $id = qint('id');
        if ($id > 0) {
            $order = get_order_full($id);
            if (!$order) {
                fail('Order not found.', 404);
            }
            json_ok($order);
        }

        [$page, $per, $offset] = page_params(25, 100);
        $where = ['1 = 1'];
        $params = [];

        $status = qs('status', 10);
        if ($status === 'cancelled') {
            $where[] = "o.status = 'cancelled'";
        } elseif ($status !== 'all') {
            $where[] = "o.status = 'active'";
        }

        $q = qs('q');
        if ($q !== '') {
            $where[] = '(o.order_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR o.salesperson LIKE ?
                         OR EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.tracking_id LIKE ?))';
            $lk = like($q);
            array_push($params, $lk, $lk, $lk, $lk, $lk);
        }
        if ($sp = qs('salesperson', 60)) {
            $where[] = 'o.salesperson = ?';
            $params[] = $sp;
        }
        if ($from = qdate('from')) {
            $where[] = 'o.order_date >= ?';
            $params[] = $from;
        }
        if ($to = qdate('to')) {
            $where[] = 'o.order_date <= ?';
            $params[] = $to;
        }
        if ($cid = qint('customer_id')) {
            $where[] = 'o.customer_id = ?';
            $params[] = $cid;
        }
        $plan = qs('plan', 10);
        if (in_array($plan, ['prepaid', 'advance', 'cod', 'credit'], true)) {
            $where[] = 'o.pay_plan = ?';
            $params[] = $plan;
        }
        $pay = qs('pay', 10);
        if ($pay === 'paid') {
            $where[] = 'COALESCE(pp.paid, 0) >= o.total_paise';
        } elseif ($pay === 'partial') {
            $where[] = 'COALESCE(pp.paid, 0) > 0 AND COALESCE(pp.paid, 0) < o.total_paise';
        } elseif ($pay === 'unpaid') {
            $where[] = 'COALESCE(pp.paid, 0) <= 0';
        }
        $w = implode(' AND ', $where);
        $from_sql = ' FROM orders o JOIN customers c ON c.id = o.customer_id ' . SQL_ORDER_PAID_JOIN . ' WHERE ' . $w;

        $tot = row("SELECT COUNT(*) AS n,
                           COALESCE(SUM(CASE WHEN o.status = 'active' THEN o.total_paise ELSE 0 END), 0) AS billed,
                           COALESCE(SUM(CASE WHEN o.status = 'active' THEN COALESCE(pp.paid, 0) ELSE 0 END), 0) AS paid,
                           COALESCE(SUM(CASE WHEN o.status = 'active' THEN " . SQL_ORDER_PROFIT . " END), 0) AS profit,
                           SUM(CASE WHEN o.status = 'active' AND " . SQL_ORDER_PROFIT . " IS NULL THEN 1 ELSE 0 END) AS no_cost" . $from_sql, $params);

        $list = rows("SELECT o.id, o.order_no, o.order_date, o.due_date, o.status, o.pay_plan, o.total_paise, o.salesperson,
                             o.subtotal_paise - o.discount_paise AS base_paise, " . SQL_ORDER_PROFIT . " AS profit_paise,
                             COALESCE(pp.paid, 0) AS paid_paise, c.id AS customer_id, c.name AS customer_name, c.phone,
                             (SELECT s.tracking_id FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS tracking_id,
                             (SELECT s.status FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS ship_status,
                             (SELECT s.courier FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS courier"
            . $from_sql . " ORDER BY o.order_date DESC, o.id DESC LIMIT $per OFFSET $offset", $params);

        foreach ($list as &$r) {
            $r['id'] = (int) $r['id'];
            $r['customer_id'] = (int) $r['customer_id'];
            $r['total_paise'] = (int) $r['total_paise'];
            $r['paid_paise'] = (int) $r['paid_paise'];
            $base = (int) $r['base_paise'];
            $r['profit_paise'] = $r['profit_paise'] !== null ? (int) $r['profit_paise'] : null;
            $r['profit_pct'] = $r['profit_paise'] !== null && $base > 0 ? round($r['profit_paise'] / $base * 100, 1) : null;
            unset($r['base_paise']);
        }
        unset($r);

        json_ok([
            'rows' => $list, 'total' => (int) $tot['n'], 'page' => $page, 'per' => $per,
            'billed_paise' => (int) $tot['billed'], 'paid_paise' => (int) $tot['paid'],
            'profit_paise' => (int) $tot['profit'], 'no_cost_orders' => (int) $tot['no_cost'],
        ]);
    }

    /* ------------------------------ Write ----------------------------- */

    $b = body();
    $action = in_str($b, 'action', 30);


    if ($action === 'save') {
        [$id, $orderNo] = save_order($b, $userId);
        json_ok(['id' => $id, 'order_no' => $orderNo]);
    }

    if ($action === 'cancel' || $action === 'restore') {
        $id = in_id($b, 'id', 'an order');
        $o = row('SELECT id, status, order_no FROM orders WHERE id = ?', [$id]);
        if (!$o) {
            fail('Order not found.', 404);
        }
        if ($action === 'cancel') {
            if ($o['status'] === 'cancelled') {
                fail('This order is already cancelled.');
            }
            $reason = in_str($b, 'reason', 200);
            db()->prepare("UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?")->execute([$reason, $id]);
            audit('order_cancelled', 'order', $id, $o['order_no'] . ($reason !== '' ? ': ' . $reason : ''));
        } else {
            if ($o['status'] === 'active') {
                fail('This order is not cancelled.');
            }
            db()->prepare("UPDATE orders SET status = 'active', cancelled_at = NULL, cancel_reason = '' WHERE id = ?")->execute([$id]);
            audit('order_restored', 'order', $id, $o['order_no']);
        }
        json_ok(get_order_full($id));
    }

    // Opens the invoice. The invoice number is given the first time and never changes.
    if ($action === 'invoice') {
        $id = in_id($b, 'id', 'an order');
        in_transaction(static function () use ($id): void {
            $o = row('SELECT id, status, invoice_no FROM orders WHERE id = ? FOR UPDATE', [$id]);
            if (!$o) {
                fail('Order not found.', 404);
            }
            if ($o['status'] !== 'active') {
                fail('A cancelled order has no invoice. Restore it first.');
            }
            if ($o['invoice_no'] === null) {
                $prefix = scalar("SELECT v FROM settings WHERE k = 'invoice_prefix'");
                $no = ($prefix === false ? 'INV-' : (string) $prefix) . next_counter('invoice');
                db()->prepare('UPDATE orders SET invoice_no = ?, invoice_date = ? WHERE id = ?')->execute([$no, today(), $id]);
                audit('invoice_issued', 'order', $id, $no);
            }
        });
        $s = settings_all();
        json_ok([
            'order' => get_order_full($id),
            'business' => [
                'name' => $s['business_name'] ?? '', 'address' => $s['business_address'] ?? '', 'phone' => $s['business_phone'] ?? '',
                'email' => $s['business_email'] ?? '', 'gstin' => $s['gstin'] ?? '', 'upi_id' => $s['upi_id'] ?? '',
                'bank_details' => $s['bank_details'] ?? '', 'terms' => $s['invoice_terms'] ?? '', 'footer' => $s['invoice_footer'] ?? '',
            ],
        ]);
    }

    fail('Unknown action.');
}



function ep_payments(): void
{
    $user = api_boot();
    $userId = (int) $user['id'];

    /* ------------------------------ Read ------------------------------ */

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        [$page, $per, $offset] = page_params(25, 100);
        $where = ['1 = 1'];
        $params = [];

        if (qint('include_void') !== 1) {
            $where[] = 'p.voided_at IS NULL';
        }
        if ($from = qdate('from')) {
            $where[] = 'p.received_on >= ?';
            $params[] = $from;
        }
        if ($to = qdate('to')) {
            $where[] = 'p.received_on <= ?';
            $params[] = $to;
        }
        // Method: UPI = paid in full up front, COD = cash on delivery, Partial paid = an advance and any later balance.
        $method = qs('method', 10);
        if ($method === 'upi') {
            $where[] = "p.purpose = 'prepaid'";
        } elseif ($method === 'cod') {
            $where[] = "p.purpose = 'cod'";
        } elseif ($method === 'partial') {
            $where[] = "p.purpose IN ('advance', 'balance')";
        }
        if (in_array(qs('type', 10), ['received', 'refund'], true)) {
            $where[] = 'p.type = ?';
            $params[] = qs('type', 10);
        }
        if ($cid = qint('customer_id')) {
            $where[] = 'p.customer_id = ?';
            $params[] = $cid;
        }
        if ($oid = qint('order_id')) {
            $where[] = 'p.order_id = ?';
            $params[] = $oid;
        }
        $q = qs('q');
        if ($q !== '') {
            $where[] = '(c.name LIKE ? OR c.phone LIKE ? OR p.reference LIKE ? OR o.order_no LIKE ?)';
            $lk = like($q);
            array_push($params, $lk, $lk, $lk, $lk);
        }

        $w = implode(' AND ', $where);
        $from_sql = ' FROM payments p JOIN customers c ON c.id = p.customer_id JOIN accounts a ON a.id = p.account_id
                      LEFT JOIN orders o ON o.id = p.order_id WHERE ' . $w;

        // Totals ignore voided payments, even when voided rows are shown in the list.
        $net = "CASE WHEN p.type = 'received' THEN p.amount_paise ELSE -p.amount_paise END";
        $tot = row("SELECT COUNT(*) AS n,
                           COALESCE(SUM(CASE WHEN p.type = 'received' THEN p.amount_paise ELSE 0 END), 0) AS received,
                           COALESCE(SUM(CASE WHEN p.type = 'refund' THEN p.amount_paise ELSE 0 END), 0) AS refunds"
            . $from_sql . ' AND p.voided_at IS NULL', $params);
        $byAccount = rows("SELECT a.id, a.name, COALESCE(SUM($net), 0) AS net_paise" . $from_sql
            . ' AND p.voided_at IS NULL GROUP BY a.id, a.name ORDER BY net_paise DESC', $params);
        $count = (int) scalar('SELECT COUNT(*)' . $from_sql, $params);

        $list = rows("SELECT p.id, p.type, p.purpose, p.amount_paise, p.method, p.reference, p.received_on, p.note,
                             p.voided_at, p.void_reason, p.order_id, o.order_no, c.id AS customer_id, c.name AS customer_name,
                             c.phone, a.id AS account_id, a.name AS account_name"
            . $from_sql . " ORDER BY p.received_on DESC, p.id DESC LIMIT $per OFFSET $offset", $params);

        foreach ($list as &$r) {
            $r['id'] = (int) $r['id'];
            $r['amount_paise'] = (int) $r['amount_paise'];
            $r['customer_id'] = (int) $r['customer_id'];
            $r['account_id'] = (int) $r['account_id'];
            $r['order_id'] = $r['order_id'] !== null ? (int) $r['order_id'] : null;
        }
        unset($r);
        foreach ($byAccount as &$r) {
            $r['id'] = (int) $r['id'];
            $r['net_paise'] = (int) $r['net_paise'];
        }
        unset($r);

        json_ok([
            'rows' => $list, 'total' => $count, 'page' => $page, 'per' => $per,
            'received_paise' => (int) $tot['received'], 'refunds_paise' => (int) $tot['refunds'],
            'by_account' => $byAccount,
        ]);
    }

    /* ------------------------------ Write ----------------------------- */

    $b = body();
    $action = in_str($b, 'action', 30);

    if ($action === 'add') {
        $in = parse_payment_input($b);
        $result = record_payment($in, $userId);
        $result['customer_balance_paise'] = customer_balance($in['customer_id']);
        json_ok($result);
    }

    if ($action === 'void') {
        $id = in_id($b, 'id', 'a payment');
        $reason = in_str($b, 'reason', 200, true, 'Reason');
        in_transaction(static function () use ($id, $reason): void {
            $p = row('SELECT id, voided_at, amount_paise FROM payments WHERE id = ? FOR UPDATE', [$id]);
            if (!$p) {
                fail('Payment not found.', 404);
            }
            if ($p['voided_at'] !== null) {
                fail('This payment is already cancelled.');
            }
            db()->prepare('UPDATE payments SET voided_at = NOW(), void_reason = ? WHERE id = ?')->execute([$reason, $id]);
            audit('payment_voided', 'payment', $id, inr((int) $p['amount_paise']) . ': ' . $reason);
        });
        json_ok(true);
    }

    fail('Unknown action.');
}



/* ------------------------------------------------------------------ */
/* Shiprocket: find the AWB (tracking ID) for an order                */
/* ------------------------------------------------------------------ */

/** One call to the Shiprocket API. Returns [http status, decoded JSON array]. */
function sr_http(string $method, string $path, array $query = [], ?array $json = null, ?string $token = null): array
{
    if (!function_exists('curl_init')) {
        fail('This server has no cURL, so it cannot reach Shiprocket.', 500);
    }
    $url = rtrim((string) SHIPROCKET['base'], '/') . '/' . ltrim($path, '/') . ($query ? '?' . http_build_query($query) : '');
    $headers = ['Accept: application/json'];
    $ch = curl_init($url);
    if ($json !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($json));
    }
    if ($token) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $out = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($out === false) {
        error_log('Shiprocket request failed: ' . $err);
        fail('Cannot reach Shiprocket right now. Try again in a minute.', 502);
    }
    $data = json_decode((string) $out, true);
    return [$code, is_array($data) ? $data : []];
}

/** Login token, kept in the session (Shiprocket tokens last 10 days). */
function sr_token(bool $fresh = false): string
{
    $email = trim((string) SHIPROCKET['email']);
    $pass = (string) SHIPROCKET['password'];
    if ($email === '' || $pass === '') {
        fail('Shiprocket is not set up yet. Put your Shiprocket API user email and password in the SHIPROCKET block at the top of api.php.');
    }
    if (!$fresh && !empty($_SESSION['sr_token']) && (int) ($_SESSION['sr_token_exp'] ?? 0) > time()) {
        return (string) $_SESSION['sr_token'];
    }
    [$code, $d] = sr_http('POST', 'auth/login', [], ['email' => $email, 'password' => $pass]);
    $t = (string) ($d['token'] ?? '');
    if ($code !== 200 || $t === '') {
        fail('Shiprocket login failed. Check the email and password in api.php (they must be a Shiprocket API user).', 502);
    }
    $_SESSION['sr_token'] = $t;
    $_SESSION['sr_token_exp'] = time() + 8 * 86400;
    return $t;
}

function sr_get(string $path, array $query): array
{
    [$code, $d] = sr_http('GET', $path, $query, null, sr_token());
    if ($code === 401) {
        [$code, $d] = sr_http('GET', $path, $query, null, sr_token(true));
    }
    if ($code === 429) {
        fail('Shiprocket says too many requests. Wait a minute and try again.', 429);
    }
    if ($code < 200 || $code >= 300) {
        fail('Shiprocket error (' . $code . '): ' . mb_substr((string) ($d['message'] ?? 'no details'), 0, 120), 502);
    }
    return $d;
}

/** Shiprocket orders matching a search word, newest first. */
function sr_orders(string $search): array
{
    $d = sr_get('orders', ['search' => $search, 'per_page' => 50, 'page' => 1, 'sort' => 'DESC', 'sort_by' => 'created_at']);
    $list = array_values(array_filter(is_array($d['data'] ?? null) ? $d['data'] : [], 'is_array'));
    usort($list, static fn($a, $b) => strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? '')));
    return $list;
}

/** Every [awb, courier] on one Shiprocket order. */
function sr_awbs(array $order): array
{
    $out = [];
    foreach (is_array($order['shipments'] ?? null) ? $order['shipments'] : [] as $s) {
        if (!is_array($s)) {
            continue;
        }
        $awb = strtoupper(preg_replace('/\s+/', '', (string) ($s['awb'] ?? $s['awb_code'] ?? '')) ?? '');
        if ($awb === '' || !preg_match('/^[A-Z0-9\-_\/]{3,60}$/', $awb)) {
            continue;
        }
        $out[] = ['awb' => $awb, 'courier' => trim((string) ($s['courier'] ?? $s['courier_name'] ?? ''))];
    }
    return $out;
}

function sr_key(string $s): string
{
    return strtolower(preg_replace('/[^a-z0-9]/i', '', $s) ?? '');
}

function sr_phone(string $s): string
{
    $d = preg_replace('/\D/', '', $s) ?? '';
    return strlen($d) > 10 ? substr($d, -10) : $d;
}

/**
 * Finds the AWB for a ledger order: first a Shiprocket order with the same order number (OG12),
 * then the customer's newest Shiprocket order by phone number. An AWB already saved on another
 * shipment is never used twice. Returns ['awb', 'courier', 'by'] or null.
 */
function sr_find_awb(string $orderNo, string $phone, int $shipmentId): ?array
{
    $free = static function (string $awb) use ($shipmentId): bool {
        return (int) scalar('SELECT COUNT(*) FROM shipments WHERE tracking_id = ? AND id <> ?', [$awb, $shipmentId]) === 0;
    };

    $want = sr_key($orderNo);
    foreach (sr_orders($orderNo) as $o) {
        if (sr_key((string) ($o['channel_order_id'] ?? '')) !== $want) {
            continue;
        }
        foreach (sr_awbs($o) as $a) {
            if ($free($a['awb'])) {
                return $a + ['by' => 'order number'];
            }
        }
    }

    $p = sr_phone($phone);
    if (strlen($p) === 10) {
        foreach (sr_orders($p) as $o) {
            if (sr_phone((string) ($o['customer_phone'] ?? '')) !== $p) {
                continue;
            }
            foreach (sr_awbs($o) as $a) {
                if ($free($a['awb'])) {
                    return $a + ['by' => 'phone number'];
                }
            }
        }
    }
    return null;
}

/** Looks up and saves the AWB (and courier) for one shipment. */
function sr_fill_shipment(int $id): array
{
    $s = row('SELECT s.id, s.courier, s.tracking_id, o.order_no, c.phone
              FROM shipments s JOIN orders o ON o.id = s.order_id JOIN customers c ON c.id = o.customer_id
              WHERE s.id = ?', [$id]);
    if (!$s) {
        fail('Shipment not found.', 404);
    }
    $hit = sr_find_awb((string) $s['order_no'], (string) $s['phone'], $id);
    if (!$hit) {
        return ['found' => false, 'order_no' => $s['order_no']];
    }
    $courier = $hit['courier'] !== '' ? mb_substr($hit['courier'], 0, 40) : (string) $s['courier'];
    db()->prepare('UPDATE shipments SET tracking_id = ?, courier = ? WHERE id = ?')->execute([$hit['awb'], $courier, $id]);
    audit('shipment_updated', 'shipment', $id, 'Shiprocket ' . trim($courier . ' ' . $hit['awb']));
    return ['found' => true, 'order_no' => $s['order_no'], 'awb' => $hit['awb'], 'courier' => $courier, 'by' => $hit['by']];
}

function ep_shipments(): void
{
    api_boot();

    /* ------------------------------ Read ------------------------------ */

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        [$page, $per, $offset] = page_params(25, 100);
        $where = ['1 = 1'];
        $params = [];

        if (qint('include_cancelled') !== 1) {
            $where[] = "o.status = 'active'";
        }
        $status = qs('status', 12);
        if (in_array($status, SHIPMENT_STATUSES, true)) {
            $where[] = 's.status = ?';
            $params[] = $status;
        }
        if (qint('needs_tracking') === 1) {
            $where[] = SQL_NEEDS_TRACKING;
        }
        $q = qs('q');
        if ($q !== '') {
            $where[] = '(s.tracking_id LIKE ? OR o.order_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)';
            $lk = like($q);
            array_push($params, $lk, $lk, $lk, $lk);
        }
        if ($oid = qint('order_id')) {
            $where[] = 's.order_id = ?';
            $params[] = $oid;
        }

        $from_sql = ' FROM shipments s JOIN orders o ON o.id = s.order_id JOIN customers c ON c.id = o.customer_id WHERE ' . implode(' AND ', $where);
        $total = (int) scalar('SELECT COUNT(*)' . $from_sql, $params);

        $list = rows("SELECT s.id, s.order_id, s.courier, s.tracking_id, s.status, s.packed_on, s.dispatched_on, s.delivered_on, s.note,
                             s.length_cm, s.breadth_cm, s.height_cm, s.weight_g,
                             o.order_no, o.order_date, o.status AS order_status, c.id AS customer_id, c.name AS customer_name,
                             c.phone, c.city, c.pincode, c.address" . $from_sql
            . " ORDER BY o.order_date DESC, s.id DESC LIMIT $per OFFSET $offset", $params);
        foreach ($list as &$r) {
            $r = ship_out($r);
            $r['id'] = (int) $r['id'];
            $r['order_id'] = (int) $r['order_id'];
            $r['customer_id'] = (int) $r['customer_id'];
            $r['needs_tracking'] = $r['tracking_id'] === ''
                && in_array($r['status'], ['pending', 'packed', 'dispatched'], true)
                && $r['courier'] !== SELF_COURIER;
        }
        unset($r);

        // Chip counts always cover every active order, whatever filter is on.
        $counts = ['all' => 0, 'needs_tracking' => 0];
        foreach (SHIPMENT_STATUSES as $s) {
            $counts[$s] = 0;
        }
        foreach (rows("SELECT s.status, COUNT(*) AS n FROM shipments s JOIN orders o ON o.id = s.order_id
                       WHERE o.status = 'active' GROUP BY s.status") as $r) {
            $counts[$r['status']] = (int) $r['n'];
            $counts['all'] += (int) $r['n'];
        }
        $counts['needs_tracking'] = (int) scalar("SELECT COUNT(*) FROM shipments s JOIN orders o ON o.id = s.order_id
                                                  WHERE o.status = 'active' AND " . SQL_NEEDS_TRACKING);

        json_ok(['rows' => $list, 'total' => $total, 'page' => $page, 'per' => $per, 'counts' => $counts]);
    }

    /* ------------------------------ Write ----------------------------- */

    $b = body();
    $action = in_str($b, 'action', 30);

    if ($action === 'update') {
        $id = in_id($b, 'id', 'a shipment');
        $s = row('SELECT * FROM shipments WHERE id = ?', [$id]);
        if (!$s) {
            fail('Shipment not found.', 404);
        }
        $courier = in_str($b, 'courier', 40);
        $tracking = clean_tracking(in_str($b, 'tracking_id', 60));
        assert_tracking_free($tracking, $id);
        $status = in_enum($b, 'status', SHIPMENT_STATUSES, 'Dispatch status');
        $note = in_str($b, 'note', 200);
        [$packed, $dispatched, $delivered] = shipment_dates($status, $s);
        [$len, $bre, $hei, $wgt] = ship_size($b, $s);

        db()->prepare('UPDATE shipments SET courier = ?, tracking_id = ?, status = ?, packed_on = ?, dispatched_on = ?,
                       delivered_on = ?, note = ?, length_cm = ?, breadth_cm = ?, height_cm = ?, weight_g = ? WHERE id = ?')
            ->execute([$courier, $tracking, $status, $packed, $dispatched, $delivered, $note, $len, $bre, $hei, $wgt, $id]);
        audit('shipment_updated', 'shipment', $id, trim($courier . ' ' . $tracking . ' ' . $status));
        json_ok(true);
    }

    if ($action === 'shiprocket') {
        json_ok(sr_fill_shipment(in_id($b, 'id', 'a shipment')));
    }

    if ($action === 'shiprocket_all') {
        sr_token(); // stops early with a clear message if Shiprocket is not set up
        $ids = rows('SELECT s.id FROM shipments s JOIN orders o ON o.id = s.order_id
                     WHERE o.status = \'active\' AND ' . SQL_NEEDS_TRACKING . ' ORDER BY s.id DESC LIMIT 25');
        $filled = [];
        $missing = [];
        $failed = 0;
        foreach ($ids as $r) {
            try {
                $res = sr_fill_shipment((int) $r['id']);
            } catch (ApiError $e) {
                if ($e->status === 429 || $e->status === 502) {
                    $failed++;
                    break;
                }
                throw $e;
            }
            if ($res['found']) {
                $filled[] = $res['order_no'] . ' ' . $res['awb'];
            } else {
                $missing[] = $res['order_no'];
            }
        }
        json_ok(['checked' => count($ids), 'filled' => $filled, 'missing' => $missing, 'stopped' => $failed > 0]);
    }

    if ($action === 'add') {
        $orderId = in_id($b, 'order_id', 'an order');
        if (!scalar('SELECT id FROM orders WHERE id = ?', [$orderId])) {
            fail('Order not found.', 404);
        }
        $courier = in_str($b, 'courier', 40);
        $tracking = clean_tracking(in_str($b, 'tracking_id', 60));
        assert_tracking_free($tracking);
        [$len, $bre, $hei, $wgt] = ship_size($b);
        db()->prepare("INSERT INTO shipments (order_id, courier, tracking_id, status, length_cm, breadth_cm, height_cm, weight_g)
                       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)")
            ->execute([$orderId, $courier, $tracking, $len, $bre, $hei, $wgt]);
        $sid = (int) db()->lastInsertId();
        audit('shipment_added', 'shipment', $sid);
        json_ok(['id' => $sid]);
    }

    fail('Unknown action.');
}



function ep_accounts(): void
{
    api_boot();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $list = rows("SELECT a.id, a.name, a.type, a.opening_paise, a.is_active,
                             COALESCE(SUM(CASE WHEN p.type = 'received' THEN p.amount_paise
                                               WHEN p.type = 'refund' THEN -p.amount_paise END), 0) AS net_paise,
                             COUNT(p.id) AS payments_n
                      FROM accounts a
                      LEFT JOIN payments p ON p.account_id = a.id AND p.voided_at IS NULL
                      GROUP BY a.id, a.name, a.type, a.opening_paise, a.is_active
                      ORDER BY a.is_active DESC, a.name");
        foreach ($list as &$r) {
            $r['id'] = (int) $r['id'];
            $r['is_active'] = (int) $r['is_active'] === 1;
            $r['opening_paise'] = (int) $r['opening_paise'];
            $r['net_paise'] = (int) $r['net_paise'];
            $r['balance_paise'] = $r['opening_paise'] + $r['net_paise'];
            $r['payments_n'] = (int) $r['payments_n'];
        }
        unset($r);
        json_ok(['rows' => $list]);
    }

    $b = body();
    if (in_str($b, 'action', 30) !== 'save') {
        fail('Unknown action.');
    }

    $id = isset($b['id']) && is_numeric($b['id']) ? (int) $b['id'] : 0;
    $name = in_str($b, 'name', 60, true, 'Account name');
    $type = in_enum($b, 'type', ['bank', 'upi', 'cash', 'wallet', 'other'], 'Account type');
    $opening = in_int($b, 'opening_paise', -MAX_PAISE, MAX_PAISE, 'Opening balance', 0);
    $active = !empty($b['is_active']) ? 1 : 0;

    if (scalar('SELECT id FROM accounts WHERE name = ? AND id <> ?', [$name, $id])) {
        fail('An account with this name already exists.', 409);
    }

    if ($id > 0) {
        if (!scalar('SELECT id FROM accounts WHERE id = ?', [$id])) {
            fail('Account not found.', 404);
        }
        if ($active === 0 && (int) scalar('SELECT COUNT(*) FROM accounts WHERE is_active = 1 AND id <> ?', [$id]) === 0) {
            fail('Keep at least one active account.');
        }
        db()->prepare('UPDATE accounts SET name = ?, type = ?, opening_paise = ?, is_active = ? WHERE id = ?')
            ->execute([$name, $type, $opening, $active, $id]);
        audit('account_updated', 'account', $id, $name);
    } else {
        db()->prepare('INSERT INTO accounts (name, type, opening_paise, is_active) VALUES (?, ?, ?, ?)')
            ->execute([$name, $type, $opening, $active]);
        $id = (int) db()->lastInsertId();
        audit('account_created', 'account', $id, $name);
    }
    json_ok(['id' => $id]);
}



/** Commission rules: fewer than `threshold` orders earn `low`, that many or more earn `high` (percent of sales). */
function commission_rules(): array
{
    $get = static function (string $k, string $default): string {
        $v = scalar('SELECT v FROM settings WHERE k = ?', [$k]);
        return ($v === false || $v === null || $v === '') ? $default : (string) $v;
    };
    return [
        'threshold' => max(1, (int) $get('comm_threshold', '12')),
        'low_pct' => (float) $get('comm_low', '7'),
        'high_pct' => (float) $get('comm_high', '8'),
    ];
}

/**
 * Commission per salesman for orders dated $from..$to. Sales = items after discounts, shipping left out.
 * Cancelled orders do not count. The rate depends on how many orders the salesman has in this period.
 */
function commission_block(string $from, string $to, array $rules): array
{
    $found = [];
    foreach (rows("SELECT o.salesperson AS sp, COUNT(*) AS n, COALESCE(SUM(o.subtotal_paise - o.discount_paise), 0) AS sales
                   FROM orders o WHERE o.status = 'active' AND o.salesperson <> '' AND o.order_date BETWEEN ? AND ?
                   GROUP BY o.salesperson", [$from, $to]) as $r) {
        $found[mb_strtolower((string) $r['sp'])] = ['name' => (string) $r['sp'], 'n' => (int) $r['n'], 'sales' => (int) $r['sales']];
    }
    // Everyone in the salesmen list shows up, even with no orders in this period.
    foreach (rows('SELECT name FROM salesmen ORDER BY name') as $r) {
        $k = mb_strtolower((string) $r['name']);
        $found[$k] ??= ['name' => (string) $r['name'], 'n' => 0, 'sales' => 0];
    }
    $out = [];
    $tOrders = 0;
    $tSales = 0;
    $tComm = 0;
    foreach ($found as $f) {
        $high = $f['n'] >= $rules['threshold'];
        $rate = $high ? $rules['high_pct'] : $rules['low_pct'];
        $comm = (int) round($f['sales'] * $rate / 100);
        $out[] = [
            'salesman' => $f['name'], 'orders_n' => $f['n'], 'sales_paise' => $f['sales'],
            'rate_pct' => $rate, 'commission_paise' => $comm,
            'more_for_high' => $high ? 0 : $rules['threshold'] - $f['n'],
        ];
        $tOrders += $f['n'];
        $tSales += $f['sales'];
        $tComm += $comm;
    }
    usort($out, static fn(array $a, array $b): int => [$b['commission_paise'], $a['salesman']] <=> [$a['commission_paise'], $b['salesman']]);
    return [
        'from' => $from, 'to' => $to, 'rows' => $out,
        'orders_n' => $tOrders, 'sales_paise' => $tSales, 'commission_paise' => $tComm,
        'no_salesman' => (int) scalar("SELECT COUNT(*) FROM orders WHERE status = 'active' AND salesperson = '' AND order_date BETWEEN ? AND ?", [$from, $to]),
    ];
}

function ep_commission(): void
{
    api_boot();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rules = commission_rules();
        $today = today();

        $month = qs('month', 7);
        if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) {
            $month = substr($today, 0, 7);
        }
        $mFrom = $month . '-01';
        $mTo = date('Y-m-t', strtotime($mFrom));

        $from = qdate('from') ?? $mFrom;
        $to = qdate('to') ?? $today;
        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }
        if ((strtotime($to) - strtotime($from)) / 86400 > 731) {
            fail('Choose a range of up to 2 years.');
        }

        json_ok([
            'rules' => $rules,
            'today' => commission_block($today, $today, $rules) + ['date' => $today],
            'month' => commission_block($mFrom, $mTo, $rules) + ['month' => $month],
            'range' => commission_block($from, $to, $rules),
        ]);
    }

    $b = body();
    if (in_str($b, 'action', 30) !== 'save_rules') {
        fail('Unknown action.');
    }
    $threshold = in_int($b, 'threshold', 1, 1000, 'Number of orders');
    $pct = static function (string $key, string $label) use ($b): string {
        $v = trim((string) ($b[$key] ?? ''));
        if (!preg_match('/^\d{1,2}(\.\d{1,2})?$|^100$/', $v)) {
            fail($label . ' must be a percentage from 0 to 100, for example 7 or 7.5.');
        }
        return (string) ((float) $v);
    };
    $low = $pct('low_pct', 'Rate below the order count');
    $high = $pct('high_pct', 'Rate at or above the order count');
    $st = db()->prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
    $st->execute(['comm_threshold', (string) $threshold]);
    $st->execute(['comm_low', $low]);
    $st->execute(['comm_high', $high]);
    audit('commission_rules_saved', 'settings', null, $threshold . ' orders: ' . $low . '% / ' . $high . '%');
    json_ok(['rules' => commission_rules()]);
}

/** The salesmen list: add, rename (orders follow the new name) and remove. */
function ep_salesmen(): void
{
    api_boot();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $list = rows("SELECT s.id, s.name, COALESCE(x.n, 0) AS orders_n, COALESCE(x.billed, 0) AS billed
                      FROM salesmen s
                      LEFT JOIN (SELECT salesperson, COUNT(*) AS n, SUM(total_paise) AS billed FROM orders
                                 WHERE status = 'active' AND salesperson <> '' GROUP BY salesperson) x ON x.salesperson = s.name
                      ORDER BY s.name");
        foreach ($list as &$r) {
            $r['id'] = (int) $r['id'];
            $r['orders_n'] = (int) $r['orders_n'];
            $r['billed_paise'] = (int) $r['billed'];
            unset($r['billed']);
        }
        unset($r);
        json_ok(['rows' => $list]);
    }

    $b = body();
    $action = in_str($b, 'action', 30);

    if ($action === 'save') {
        $id = isset($b['id']) && is_numeric($b['id']) ? (int) $b['id'] : 0;
        $name = in_str($b, 'name', 60, true, 'Salesman name');
        if (scalar('SELECT id FROM salesmen WHERE name = ? AND id <> ?', [$name, $id])) {
            fail('This salesman is already in the list.', 409);
        }
        if ($id > 0) {
            $old = scalar('SELECT name FROM salesmen WHERE id = ?', [$id]);
            if ($old === false || $old === null) {
                fail('Salesman not found.', 404);
            }
            in_transaction(static function () use ($id, $name, $old): void {
                db()->prepare('UPDATE salesmen SET name = ? WHERE id = ?')->execute([$name, $id]);
                db()->prepare('UPDATE orders SET salesperson = ? WHERE salesperson = ?')->execute([$name, $old]);
            });
            audit('salesman_renamed', 'salesman', $id, $old . ' to ' . $name);
        } else {
            db()->prepare('INSERT INTO salesmen (name) VALUES (?)')->execute([$name]);
            $id = (int) db()->lastInsertId();
            audit('salesman_created', 'salesman', $id, $name);
        }
        json_ok(['id' => $id, 'name' => $name]);
    }

    // Removing only takes the name out of the dropdown. Orders that already have it keep it.
    if ($action === 'delete') {
        $id = in_id($b, 'id', 'a salesman');
        $name = scalar('SELECT name FROM salesmen WHERE id = ?', [$id]);
        if ($name === false || $name === null) {
            fail('Salesman not found.', 404);
        }
        db()->prepare('DELETE FROM salesmen WHERE id = ?')->execute([$id]);
        audit('salesman_deleted', 'salesman', $id, (string) $name);
        json_ok(true);
    }

    fail('Unknown action.');
}

function ep_products(): void
{
    api_boot();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $where = ['1 = 1'];
        $params = [];
        if (qint('active') === 1) {
            $where[] = 'is_active = 1';
        }
        $q = qs('q');
        if ($q !== '') {
            $where[] = '(name LIKE ? OR sku LIKE ?)';
            $lk = like($q);
            array_push($params, $lk, $lk);
        }
        [$page, $per, $offset] = page_params(50, 200);
        $w = implode(' AND ', $where);
        $total = (int) scalar("SELECT COUNT(*) FROM products WHERE $w", $params);
        $list = rows("SELECT id, sku, name, rate_paise, cost_paise, image, is_active FROM products WHERE $w
                      ORDER BY name LIMIT $per OFFSET $offset", $params);
        foreach ($list as &$r) {
            $r['id'] = (int) $r['id'];
            $r['rate_paise'] = (int) $r['rate_paise'];
            $r['cost_paise'] = (int) $r['cost_paise'];
            $r['is_active'] = (int) $r['is_active'] === 1;
        }
        unset($r);
        json_ok(['rows' => $list, 'total' => $total, 'page' => $page, 'per' => $per]);
    }

    $b = body();
    if (in_str($b, 'action', 30) !== 'save') {
        fail('Unknown action.');
    }

    $id = isset($b['id']) && is_numeric($b['id']) ? (int) $b['id'] : 0;
    $name = in_str($b, 'name', 160, true, 'Product name');
    $sku = in_str($b, 'sku', 40);
    $rate = in_paise($b, 'rate_paise', 'Rate', true);
    $cost = in_paise($b, 'cost_paise', 'Cost', true);
    $active = !empty($b['is_active']) ? 1 : 0;
    $image = in_image($b['image'] ?? '');

    if ($sku !== '' && scalar('SELECT id FROM products WHERE sku = ? AND id <> ?', [$sku, $id])) {
        fail('Another product already uses this SKU.', 409);
    }
    $skuValue = $sku === '' ? null : $sku;

    if ($id > 0) {
        if (!scalar('SELECT id FROM products WHERE id = ?', [$id])) {
            fail('Product not found.', 404);
        }
        db()->prepare('UPDATE products SET sku = ?, name = ?, rate_paise = ?, cost_paise = ?, is_active = ?, image = IF(? = \'\', image, ?) WHERE id = ?')
            ->execute([$skuValue, $name, $rate, $cost, $active, $image, $image, $id]);
        audit('product_updated', 'product', $id, $name);
    } else {
        db()->prepare('INSERT INTO products (sku, name, rate_paise, cost_paise, is_active, image) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$skuValue, $name, $rate, $cost, $active, $image]);
        $id = (int) db()->lastInsertId();
        audit('product_created', 'product', $id, $name);
    }
    json_ok(['id' => $id]);
}

/** Saves a product photo sent as a data URL (the browser shrinks it first). Returns its address. */
function ep_upload(): void
{
    api_boot();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $data = (string) (body()['data'] ?? '');
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$#', $data, $m)) {
        fail('Choose a JPG, PNG or WebP photo.');
    }
    $raw = base64_decode($m[2], true);
    if ($raw === false || $raw === '' || strlen($raw) > 900000) {
        fail('That photo is too large. Choose a smaller one.');
    }
    $info = @getimagesizefromstring($raw);
    $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'];
    if (!$info || !isset($types[$info[2]]) || $info[0] < 1 || $info[1] < 1 || $info[0] * $info[1] > 40000000) {
        fail('That file is not a valid photo.');
    }
    $ext = $types[$info[2]];

    // Re-draw the picture with GD when the server has it: drops anything hidden in the file and keeps it small.
    if (function_exists('imagecreatefromstring') && function_exists('imagejpeg')) {
        $src = @imagecreatefromstring($raw);
        if ($src !== false) {
            $w = imagesx($src);
            $h = imagesy($src);
            $scale = min(1, 900 / max($w, $h));
            $nw = max(1, (int) round($w * $scale));
            $nh = max(1, (int) round($h * $scale));
            $dst = imagecreatetruecolor($nw, $nh);
            imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
            ob_start();
            imagejpeg($dst, null, 85);
            $out = (string) ob_get_clean();
            if ($out !== '') {
                $raw = $out;
                $ext = 'jpg';
            }
        }
    }

    $dir = __DIR__ . '/uploads';
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        fail('The server cannot create the uploads folder. Create a folder named uploads next to api.php.', 500);
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "Options -Indexes\nphp_flag engine off\n<FilesMatch \"\\.(php|phtml|phar|php[0-9])$\">\n  Require all denied\n</FilesMatch>\n");
        @file_put_contents($dir . '/index.html', '');
    }
    $name = bin2hex(random_bytes(12)) . '.' . $ext;
    if (@file_put_contents($dir . '/' . $name, $raw) === false) {
        fail('Could not save the photo on the server.', 500);
    }
    json_ok(['url' => 'uploads/' . $name]);
}

const PROFILE_FIELDS = [
    'business_name' => 120, 'business_address' => 300, 'business_phone' => 40, 'business_email' => 120,
    'gstin' => 20, 'upi_id' => 80, 'bank_details' => 500, 'invoice_prefix' => 10,
    'invoice_terms' => 500, 'invoice_footer' => 200,
];

function counter_state(): array
{
    $out = [];
    foreach (rows('SELECT name, value FROM counters') as $r) {
        $out[$r['name']] = (int) $r['value'];
    }
    return [
        'next_order' => ($out['order'] ?? 0) + 1,
        'next_invoice' => ($out['invoice'] ?? 0) + 1,
    ];
}

function ep_settings(): void
{
    $user = api_boot();



    /* ------------------------------ Read ------------------------------ */

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        json_ok(['profile' => settings_all(), 'counters' => counter_state()]);
    }

    /* ------------------------------ Write ----------------------------- */

    $b = body();
    $action = in_str($b, 'action', 30);

    if ($action === 'save_profile') {
        $values = [];
        foreach (PROFILE_FIELDS as $key => $max) {
            $values[$key] = in_str($b, $key, $max, $key === 'business_name', ucfirst(str_replace('_', ' ', $key)));
        }
        if (!preg_match('/^[A-Za-z0-9_\-\/]{0,10}$/', $values['invoice_prefix'])) {
            fail('Prefixes can use only letters, numbers and - _ /.');
        }
        $st = db()->prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
        foreach ($values as $k => $v) {
            $st->execute([$k, $v]);
        }
        audit('settings_saved', 'settings');
        json_ok(['profile' => settings_all()]);
    }

    // Lets you continue an existing numbering (for example start at TM-2042). Numbers can only move forward.
    if ($action === 'save_counters') {
        $state = counter_state();
        foreach (['order' => 'next_order', 'invoice' => 'next_invoice'] as $name => $key) {
            if (!isset($b[$key]) || $b[$key] === '') {
                continue;
            }
            $next = in_int($b, $key, 1, 999999999, 'Next ' . $name . ' number');
            if ($next < $state[$key]) {
                fail('Next ' . $name . ' number must be at least ' . $state[$key] . ' (numbers already used cannot be reused).');
            }
            db()->prepare('UPDATE counters SET value = ? WHERE name = ?')->execute([$next - 1, $name]);
            audit('counter_set', 'settings', null, $name . ' next = ' . $next);
        }
        json_ok(['counters' => counter_state()]);
    }

    fail('Unknown action.');
}



function ep_reports(): void
{
    api_boot();

    $today = today();
    $from = qdate('from') ?? date('Y-m-01');
    $to = qdate('to') ?? $today;
    if ($from > $to) {
        [$from, $to] = [$to, $from];
    }
    $days = (int) ((strtotime($to) - strtotime($from)) / 86400) + 1;
    if ($days > 731) {
        fail('Choose a range of up to 2 years.');
    }

    $net = "CASE WHEN p.type = 'received' THEN p.amount_paise ELSE -p.amount_paise END";

    $sales = row("SELECT COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS billed, COALESCE(SUM(discount_paise), 0) AS discount,
                         COALESCE(SUM(shipping_paise), 0) AS shipping
                  FROM orders WHERE status = 'active' AND order_date BETWEEN ? AND ?", [$from, $to]);
    $prof = row("SELECT COUNT(*) AS n, COALESCE(SUM(t.p IS NULL), 0) AS missing, COALESCE(SUM(t.p), 0) AS profit,
                        COALESCE(SUM(CASE WHEN t.p IS NOT NULL THEN t.base END), 0) AS base
                 FROM (SELECT " . SQL_ORDER_PROFIT . " AS p, o.subtotal_paise - o.discount_paise AS base
                       FROM orders o WHERE o.status = 'active' AND o.order_date BETWEEN ? AND ?) t", [$from, $to]);
    $cash = row("SELECT COALESCE(SUM(CASE WHEN type = 'received' THEN amount_paise ELSE 0 END), 0) AS received,
                        COALESCE(SUM(CASE WHEN type = 'refund' THEN amount_paise ELSE 0 END), 0) AS refunds
                 FROM payments WHERE voided_at IS NULL AND received_on BETWEEN ? AND ?", [$from, $to]);
    $owing = row('SELECT COALESCE(SUM(bal), 0) AS total, COUNT(*) AS n FROM (
                    SELECT ' . SQL_CUST_BALANCE . ' AS bal FROM customers c) t WHERE bal > 0');

    // Chart series: one point per day for short ranges, per month for long ones.
    $bucket = $days <= 62 ? '%Y-%m-%d' : '%Y-%m';
    $series = [];
    foreach (rows("SELECT DATE_FORMAT(order_date, '$bucket') AS k, SUM(total_paise) AS v FROM orders
                   WHERE status = 'active' AND order_date BETWEEN ? AND ? GROUP BY k", [$from, $to]) as $r) {
        $series[$r['k']]['billed'] = (int) $r['v'];
    }
    foreach (rows("SELECT DATE_FORMAT(received_on, '$bucket') AS k, SUM(" . SQL_NET . ") AS v FROM payments
                   WHERE voided_at IS NULL AND received_on BETWEEN ? AND ? GROUP BY k", [$from, $to]) as $r) {
        $series[$r['k']]['collected'] = (int) $r['v'];
    }
    ksort($series);
    $seriesOut = [];
    foreach ($series as $k => $v) {
        $seriesOut[] = ['label' => $k, 'billed_paise' => $v['billed'] ?? 0, 'collected_paise' => $v['collected'] ?? 0];
    }

    $byAccount = rows("SELECT a.id, a.name, a.type, a.opening_paise,
                              COALESCE(SUM(CASE WHEN p.received_on BETWEEN ? AND ? THEN $net END), 0) AS period_paise,
                              COALESCE(SUM($net), 0) AS lifetime_paise
                       FROM accounts a LEFT JOIN payments p ON p.account_id = a.id AND p.voided_at IS NULL
                       GROUP BY a.id, a.name, a.type, a.opening_paise ORDER BY period_paise DESC, a.name", [$from, $to]);
    foreach ($byAccount as &$r) {
        $r['period_paise'] = (int) $r['period_paise'];
        $r['balance_paise'] = (int) $r['opening_paise'] + (int) $r['lifetime_paise'];
        unset($r['lifetime_paise'], $r['opening_paise']);
    }
    unset($r);

    $byMethod = rows("SELECT p.method, COUNT(*) AS n, SUM($net) AS v FROM payments p
                      WHERE p.voided_at IS NULL AND p.received_on BETWEEN ? AND ? GROUP BY p.method ORDER BY v DESC", [$from, $to]);
    $byPurpose = rows("SELECT p.purpose, COUNT(*) AS n, SUM($net) AS v FROM payments p
                       WHERE p.voided_at IS NULL AND p.received_on BETWEEN ? AND ? GROUP BY p.purpose ORDER BY v DESC", [$from, $to]);
    $byPlan = rows("SELECT pay_plan, COUNT(*) AS n, SUM(total_paise) AS v FROM orders
                    WHERE status = 'active' AND order_date BETWEEN ? AND ? GROUP BY pay_plan ORDER BY v DESC", [$from, $to]);

    $bySales = rows("SELECT t.sp, COUNT(*) AS n, SUM(t.total) AS billed, COALESCE(SUM(t.p), 0) AS profit,
                            COALESCE(SUM(t.p IS NULL), 0) AS missing,
                            COALESCE(SUM(CASE WHEN t.p IS NOT NULL THEN t.base END), 0) AS base
                     FROM (SELECT o.salesperson AS sp, o.total_paise AS total, " . SQL_ORDER_PROFIT . " AS p,
                                  o.subtotal_paise - o.discount_paise AS base
                           FROM orders o WHERE o.status = 'active' AND o.order_date BETWEEN ? AND ?) t
                     GROUP BY t.sp ORDER BY billed DESC", [$from, $to]);
    $bySalesOut = array_map(static fn(array $r): array => [
        'salesperson' => (string) $r['sp'], 'n' => (int) $r['n'], 'billed_paise' => (int) $r['billed'],
        'profit_paise' => (int) $r['profit'], 'missing' => (int) $r['missing'],
        'profit_pct' => (int) $r['base'] > 0 ? round((int) $r['profit'] / (int) $r['base'] * 100, 1) : null,
    ], $bySales);

    $ageing = [['label' => '0 to 7 days', 'n' => 0, 'paise' => 0], ['label' => '8 to 30 days', 'n' => 0, 'paise' => 0],
               ['label' => '31 to 60 days', 'n' => 0, 'paise' => 0], ['label' => 'Over 60 days', 'n' => 0, 'paise' => 0]];
    foreach (rows("SELECT DATEDIFF(?, o.order_date) AS d, o.total_paise - COALESCE(pp.paid, 0) AS bal
                   FROM orders o " . SQL_ORDER_PAID_JOIN . "
                   WHERE o.status = 'active' AND o.total_paise - COALESCE(pp.paid, 0) > 0", [$today]) as $r) {
        $d = (int) $r['d'];
        $i = $d <= 7 ? 0 : ($d <= 30 ? 1 : ($d <= 60 ? 2 : 3));
        $ageing[$i]['n']++;
        $ageing[$i]['paise'] += (int) $r['bal'];
    }

    $top = rows("SELECT c.id, c.name, COUNT(*) AS orders_n, SUM(o.total_paise) AS billed
                 FROM orders o JOIN customers c ON c.id = o.customer_id
                 WHERE o.status = 'active' AND o.order_date BETWEEN ? AND ?
                 GROUP BY c.id, c.name ORDER BY billed DESC LIMIT 10", [$from, $to]);
    foreach ($top as &$r) {
        $r['id'] = (int) $r['id'];
        $r['orders_n'] = (int) $r['orders_n'];
        $r['billed_paise'] = (int) $r['billed'];
        $r['balance_paise'] = customer_balance($r['id']);
        unset($r['billed']);
    }
    unset($r);

    $conv = static fn(array $rows, string $key): array => array_map(static fn(array $r): array => [
        $key => $r[$key], 'n' => (int) $r['n'], 'paise' => (int) $r['v'],
    ], $rows);

    json_ok([
        'from' => $from, 'to' => $to, 'days' => $days,
        'summary' => [
            'orders' => (int) $sales['n'], 'billed_paise' => (int) $sales['billed'],
            'discount_paise' => (int) $sales['discount'], 'shipping_paise' => (int) $sales['shipping'],
            'received_paise' => (int) $cash['received'], 'refunds_paise' => (int) $cash['refunds'],
            'collected_paise' => (int) $cash['received'] - (int) $cash['refunds'],
            'outstanding_paise' => (int) $owing['total'], 'owing_customers' => (int) $owing['n'],
            'profit_paise' => (int) $prof['profit'], 'no_cost_orders' => (int) $prof['missing'],
            'profit_pct' => (int) $prof['base'] > 0 ? round((int) $prof['profit'] / (int) $prof['base'] * 100, 1) : null,
        ],
        'by_salesperson' => $bySalesOut,
        'series' => $seriesOut, 'bucket' => $days <= 62 ? 'day' : 'month',
        'by_account' => $byAccount,
        'by_method' => $conv($byMethod, 'method'),
        'by_purpose' => $conv($byPurpose, 'purpose'),
        'by_plan' => $conv($byPlan, 'pay_plan'),
        'ageing' => $ageing,
        'top_customers' => $top,
    ]);
}

/** A zip file in memory (compressed when zlib is there). */
function zip_files(array $files): string
{
    $out = '';
    $central = '';
    $count = 0;
    $time = ((int) date('H') << 11) | ((int) date('i') << 5) | ((int) date('s') >> 1);
    $date = (((int) date('Y') - 1980) << 9) | ((int) date('n') << 5) | (int) date('j');
    foreach ($files as $name => $data) {
        $crc = crc32($data);
        $size = strlen($data);
        $packed = function_exists('gzdeflate') ? gzdeflate($data, 6) : false;
        $method = $packed === false ? 0 : 8;
        $body = $packed === false ? $data : $packed;
        $offset = strlen($out);
        $out .= pack('VvvvvvVVVvv', 0x04034b50, 20, 0, $method, $time, $date, $crc, strlen($body), $size, strlen($name), 0) . $name . $body;
        $central .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0, $method, $time, $date, $crc, strlen($body), $size, strlen($name), 0, 0, 0, 0, 0, $offset) . $name;
        $count++;
    }
    return $out . $central . pack('VvvvvVVv', 0x06054b50, 0, 0, $count, $count, strlen($central), strlen($out), 0);
}

function xl_col(int $i): string
{
    $s = '';
    for ($i++; $i > 0; $i = intdiv($i - 1, 26)) {
        $s = chr(65 + ($i - 1) % 26) . $s;
    }
    return $s;
}

function xl_esc(string $s): string
{
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $s) ?? '';
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

/**
 * One-sheet Excel file (.xlsx).
 * $cols: [[heading, kind], ...] where kind is s = text, n = whole number, m = money given in paise, d = date (YYYY-MM-DD).
 */
function xlsx_file(string $sheet, array $cols, array $rows): string
{
    $widths = [];
    foreach ($cols as $i => $c) {
        $widths[$i] = max(10, mb_strlen($c[0]) + 3);
    }
    $xml = '';
    $line = 1;
    $head = '';
    foreach ($cols as $i => $c) {
        $head .= '<c r="' . xl_col($i) . '1" t="inlineStr" s="1"><is><t>' . xl_esc($c[0]) . '</t></is></c>';
    }
    $xml .= '<row r="1">' . $head . '</row>';
    foreach ($rows as $r) {
        $line++;
        $cells = '';
        foreach ($cols as $i => $c) {
            $v = $r[$i] ?? '';
            $ref = xl_col($i) . $line;
            if ($v === '' || $v === null) {
                continue;
            }
            if ($c[1] === 'm') {
                $cells .= '<c r="' . $ref . '" s="2"><v>' . number_format((int) $v / 100, 2, '.', '') . '</v></c>';
                $widths[$i] = max($widths[$i], 14);
            } elseif ($c[1] === 'n') {
                $cells .= '<c r="' . $ref . '"><v>' . (int) $v . '</v></c>';
            } elseif ($c[1] === 'd' && preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $v)) {
                $serial = (int) (strtotime(substr((string) $v, 0, 10) . ' UTC') / 86400) + 25569;
                $cells .= '<c r="' . $ref . '" s="3"><v>' . $serial . '</v></c>';
                $widths[$i] = max($widths[$i], 14);
            } else {
                $cells .= '<c r="' . $ref . '" t="inlineStr"><is><t xml:space="preserve">' . xl_esc((string) $v) . '</t></is></c>';
                $widths[$i] = max($widths[$i], min(45, mb_strlen((string) $v) + 2));
            }
        }
        $xml .= '<row r="' . $line . '">' . $cells . '</row>';
    }
    $colXml = '';
    foreach ($widths as $i => $w) {
        $colXml .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . $w . '" customWidth="1"/>';
    }
    $ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    $hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' . "\n";
    $last = xl_col(count($cols) - 1) . max(1, $line);

    return zip_files([
        '[Content_Types].xml' => $hdr . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        '_rels/.rels' => $hdr . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml' => $hdr . '<workbook xmlns="' . $ns . '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheets><sheet name="' . xl_esc($sheet) . '" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels' => $hdr . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'xl/styles.xml' => $hdr . '<styleSheet xmlns="' . $ns . '">'
            . '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd\-mmm\-yyyy"/></numFmts>'
            . '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
            . '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
            . '<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF4"/><bgColor indexed="64"/></patternFill></fill></fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            . '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
            . '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            . '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
        'xl/worksheets/sheet1.xml' => $hdr . '<worksheet xmlns="' . $ns . '">'
            . '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            . '<cols>' . $colXml . '</cols><sheetData>' . $xml . '</sheetData><autoFilter ref="A1:' . $last . '"/></worksheet>',
    ]);
}

function ep_export(): void
{
    api_boot();

    $type = qs('type', 12);
    $from = qdate('from');
    $to = qdate('to');





    $names = ['orders', 'payments', 'customers'];
    if (!in_array($type, $names, true)) {
        fail('Unknown export.');
    }

    $rowsOut = [];
    if ($type === 'orders') {
        $where = ['1 = 1'];
        $params = [];
        if ($from) {
            $where[] = 'o.order_date >= ?';
            $params[] = $from;
        }
        if ($to) {
            $where[] = 'o.order_date <= ?';
            $params[] = $to;
        }
        $cols = [['Order no', 's'], ['Date', 'd'], ['Customer', 's'], ['Phone', 's'], ['Status', 's'], ['Payment type', 's'],
                 ['Subtotal', 'm'], ['Discount', 'm'], ['Shipping', 'm'], ['Total', 'm'], ['Paid', 'm'], ['Balance', 'm'],
                 ['Courier', 's'], ['Tracking ID', 's'], ['Dispatch status', 's'], ['Length (cm)', 's'], ['Breadth (cm)', 's'],
                 ['Height (cm)', 's'], ['Weight (kg)', 's'], ['Invoice no', 's'],
                 ['Salesman', 's'], ['Purchase cost', 'm'], ['Profit', 'm'], ['Profit %', 's']];
        foreach (rows("SELECT o.*, " . SQL_ORDER_PROFIT . " AS profit_paise, c.name AS c_name, c.phone AS c_phone, COALESCE(pp.paid, 0) AS paid,
                              (SELECT s.courier FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS courier,
                              (SELECT s.tracking_id FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS tracking,
                              (SELECT s.status FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS ship_status,
                              (SELECT s.length_cm FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS len_cm,
                              (SELECT s.breadth_cm FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS bre_cm,
                              (SELECT s.height_cm FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS hei_cm,
                              (SELECT s.weight_g FROM shipments s WHERE s.order_id = o.id ORDER BY s.id LIMIT 1) AS wgt_g
                       FROM orders o JOIN customers c ON c.id = o.customer_id " . SQL_ORDER_PAID_JOIN . "
                       WHERE " . implode(' AND ', $where) . " ORDER BY o.order_date, o.id LIMIT 50000", $params) as $r) {
            $bal = $r['status'] === 'active' ? (int) $r['total_paise'] - (int) $r['paid'] : 0;
            $xBase = (int) $r['subtotal_paise'] - (int) $r['discount_paise'];
            $num = static fn ($v): string => $v === null ? '' : (string) (float) $v;
            $rowsOut[] = [$r['order_no'], $r['order_date'], $r['c_name'], $r['c_phone'], $r['status'], $r['pay_plan'],
                          (int) $r['subtotal_paise'], (int) $r['discount_paise'], (int) $r['shipping_paise'], (int) $r['total_paise'],
                          (int) $r['paid'], $bal, $r['courier'] ?? '', $r['tracking'] ?? '', $r['ship_status'] ?? '',
                          $num($r['len_cm']), $num($r['bre_cm']), $num($r['hei_cm']),
                          $r['wgt_g'] === null ? '' : (string) round((int) $r['wgt_g'] / 1000, 3), $r['invoice_no'] ?? '',
                          $r['salesperson'], $xBase !== null && $r['profit_paise'] !== null ? $xBase - (int) $r['profit_paise'] : '',
                          $r['profit_paise'] !== null ? (int) $r['profit_paise'] : '',
                          $r['profit_paise'] !== null && $xBase > 0 ? (string) round((int) $r['profit_paise'] / $xBase * 100, 1) : ''];
        }
        $sheet = 'Orders';
    } elseif ($type === 'payments') {
        $where = ['1 = 1'];
        $params = [];
        if ($from) {
            $where[] = 'p.received_on >= ?';
            $params[] = $from;
        }
        if ($to) {
            $where[] = 'p.received_on <= ?';
            $params[] = $to;
        }
        $cols = [['Date', 'd'], ['Customer', 's'], ['Phone', 's'], ['Order no', 's'], ['Type', 's'], ['Purpose', 's'],
                 ['Account', 's'], ['Amount', 'm'], ['Note', 's'], ['Cancelled', 's']];
        foreach (rows("SELECT p.*, c.name AS c_name, c.phone AS c_phone, a.name AS a_name, o.order_no
                       FROM payments p JOIN customers c ON c.id = p.customer_id JOIN accounts a ON a.id = p.account_id
                       LEFT JOIN orders o ON o.id = p.order_id
                       WHERE " . implode(' AND ', $where) . " ORDER BY p.received_on, p.id LIMIT 50000", $params) as $r) {
            $rowsOut[] = [$r['received_on'], $r['c_name'], $r['c_phone'], $r['order_no'] ?? '', $r['type'], $r['purpose'],
                          $r['a_name'], (int) $r['amount_paise'], $r['note'], $r['voided_at'] !== null ? 'yes' : ''];
        }
        $sheet = 'Payments';
    } else {
        $cols = [['Name', 's'], ['Phone', 's'], ['City', 's'], ['Orders', 'n'], ['Billed', 'm'], ['Received', 'm'], ['Balance (owes you)', 'm']];
        foreach (rows("SELECT c.name, c.phone, c.city, c.opening_paise,
                              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'active') AS orders_n,
                              COALESCE((SELECT SUM(o.total_paise) FROM orders o WHERE o.customer_id = c.id AND o.status = 'active'), 0) AS billed,
                              COALESCE((SELECT SUM(" . SQL_NET . ") FROM payments WHERE customer_id = c.id AND voided_at IS NULL), 0) AS received,
                              " . SQL_CUST_BALANCE . " AS bal
                       FROM customers c ORDER BY c.name LIMIT 50000") as $r) {
            $rowsOut[] = [$r['name'], $r['phone'], $r['city'], (int) $r['orders_n'], (int) $r['billed'], (int) $r['received'], (int) $r['bal']];
        }
        $sheet = 'Customers';
    }

    audit('export', 'export', null, $type . ' ' . count($rowsOut) . ' rows');

    $file = xlsx_file($sheet, $cols, $rowsOut);
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $type . '-' . date('Ymd') . '.xlsx"');
    header('Content-Length: ' . strlen($file));
    echo $file;
    exit;
}


/* ================================================================== *
 * 4. ROUTER: the pages call api.php?r=orders, api.php?r=payments ... *
 * ================================================================== */

$route = (string) ($_GET['r'] ?? '');
$routes = [
    'auth' => 'ep_auth',
    'dashboard' => 'ep_dashboard',
    'customers' => 'ep_customers',
    'orders' => 'ep_orders',
    'payments' => 'ep_payments',
    'shipments' => 'ep_shipments',
    'accounts' => 'ep_accounts',
    'products' => 'ep_products',
    'salesmen' => 'ep_salesmen',
    'commission' => 'ep_commission',
    'settings' => 'ep_settings',
    'reports' => 'ep_reports',
    'export' => 'ep_export',
    'upload' => 'ep_upload',
];
if ($route === '') {
    header('Location: index.html');
    exit;
}
if (!isset($routes[$route])) {
    boot();
    json_fail('Unknown request.', 404);
}
$routes[$route]();