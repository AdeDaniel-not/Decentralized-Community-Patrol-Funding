(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-TOKEN u102)
(define-constant ERR-INVALID-DONATION-ID u103)
(define-constant ERR-INVALID-TIMESTAMP u104)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u105)
(define-constant ERR-INVALID-MIN-DONATION u106)
(define-constant ERR-INVALID-MAX-DONATION u107)
(define-constant ERR-POOL-UPDATE-NOT-ALLOWED u108)
(define-constant ERR-INVALID-UPDATE-PARAM u109)
(define-constant ERR-MAX-POOLS-EXCEEDED u110)
(define-constant ERR-INVALID-POOL-TYPE u111)
(define-constant ERR-INVALID-FEE-RATE u112)
(define-constant ERR-INVALID-GRACE-PERIOD u113)
(define-constant ERR-INVALID-LOCATION u114)
(define-constant ERR-INVALID-CURRENCY u115)
(define-constant ERR-INVALID-STATUS u116)
(define-constant ERR-POOL-ALREADY-EXISTS u117)
(define-constant ERR-POOL-NOT-FOUND u118)
(define-constant ERR-INSUFFICIENT-BALANCE u119)
(define-constant ERR-TRANSFER-FAILED u120)

(define-trait token-trait
  (
    (transfer (principal uint) (response bool uint))
    (get-balance (principal) (response uint uint))
  )
)

(define-data-var next-pool-id uint u0)
(define-data-var max-pools uint u1000)
(define-data-var creation-fee uint u1000)
(define-data-var authority-contract (optional principal) none)

(define-map pools
  uint
  {
    name: (string-utf8 100),
    min-donation: uint,
    max-donation: uint,
    total-donations: uint,
    timestamp: uint,
    creator: principal,
    pool-type: (string-utf8 50),
    fee-rate: uint,
    grace-period: uint,
    location: (string-utf8 100),
    currency: (string-utf8 20),
    status: bool,
    token-contract: principal
  }
)

(define-map pools-by-name
  (string-utf8 100)
  uint
)

(define-map pool-updates
  uint
  {
    update-name: (string-utf8 100),
    update-min-donation: uint,
    update-max-donation: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-map donations
  { pool-id: uint, donor: principal }
  { amount: uint, timestamp: uint }
)

(define-map total-donations-per-pool
  uint
  uint
)

(define-read-only (get-pool (id uint))
  (map-get? pools id)
)

(define-read-only (get-pool-updates (id uint))
  (map-get? pool-updates id)
)

(define-read-only (is-pool-registered (name (string-utf8 100)))
  (is-some (map-get? pools-by-name name))
)

(define-read-only (get-donation (pool-id uint) (donor principal))
  (map-get? donations { pool-id: pool-id, donor: donor })
)

(define-read-only (get-total-donations (pool-id uint))
  (default-to u0 (map-get? total-donations-per-pool pool-id))
)

(define-private (validate-name (name (string-utf8 100)))
  (if (and (> (len name) u0) (<= (len name) u100))
    (ok true)
    (err ERR-INVALID-UPDATE-PARAM))
)

(define-private (validate-min-donation (amount uint))
  (if (> amount u0)
    (ok true)
    (err ERR-INVALID-MIN-DONATION))
)

(define-private (validate-max-donation (amount uint))
  (if (> amount u0)
    (ok true)
    (err ERR-INVALID-MAX-DONATION))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-pool-type (type (string-utf8 50)))
  (if (or (is-eq type "community") (is-eq type "emergency") (is-eq type "ongoing"))
    (ok true)
    (err ERR-INVALID-POOL-TYPE))
)

(define-private (validate-fee-rate (rate uint))
  (if (<= rate u10)
    (ok true)
    (err ERR-INVALID-FEE-RATE))
)

(define-private (validate-grace-period (period uint))
  (if (<= period u30)
    (ok true)
    (err ERR-INVALID-GRACE-PERIOD))
)

(define-private (validate-location (loc (string-utf8 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
    (ok true)
    (err ERR-INVALID-LOCATION))
)

(define-private (validate-currency (cur (string-utf8 20)))
  (if (or (is-eq cur "STX") (is-eq cur "USD") (is-eq cur "BTC"))
    (ok true)
    (err ERR-INVALID-CURRENCY))
)

(define-private (validate-token-contract (token principal))
  (if (not (is-eq token 'SP000000000000000000002Q6VF78))
    (ok true)
    (err ERR-INVALID-TOKEN))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
    (ok true)
    (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-pools (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-pools new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (create-pool
  (pool-name (string-utf8 100))
  (min-donation uint)
  (max-donation uint)
  (pool-type (string-utf8 50))
  (fee-rate uint)
  (grace-period uint)
  (location (string-utf8 100))
  (currency (string-utf8 20))
  (token-contract principal)
)
  (let (
    (next-id (var-get next-pool-id))
    (current-max (var-get max-pools))
    (authority (var-get authority-contract))
  )
    (asserts! (< next-id current-max) (err ERR-MAX-POOLS-EXCEEDED))
    (try! (validate-name pool-name))
    (try! (validate-min-donation min-donation))
    (try! (validate-max-donation max-donation))
    (try! (validate-pool-type pool-type))
    (try! (validate-fee-rate fee-rate))
    (try! (validate-grace-period grace-period))
    (try! (validate-location location))
    (try! (validate-currency currency))
    (try! (validate-token-contract token-contract))
    (asserts! (is-none (map-get? pools-by-name pool-name)) (err ERR-POOL-ALREADY-EXISTS))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get creation-fee) tx-sender authority-recipient))
    )
    (map-set pools next-id
      {
        name: pool-name,
        min-donation: min-donation,
        max-donation: max-donation,
        total-donations: u0,
        timestamp: block-height,
        creator: tx-sender,
        pool-type: pool-type,
        fee-rate: fee-rate,
        grace-period: grace-period,
        location: location,
        currency: currency,
        status: true,
        token-contract: token-contract
      }
    )
    (map-set pools-by-name pool-name next-id)
    (map-set total-donations-per-pool next-id u0)
    (var-set next-pool-id (+ next-id u1))
    (print { event: "pool-created", id: next-id })
    (ok next-id)
  )
)

(define-public (donate-to-pool
  (pool-id uint)
  (amount uint)
  (token <token-trait>)
)
  (let (
    (pool (unwrap! (map-get? pools pool-id) (err ERR-POOL-NOT-FOUND)))
    (current-total (default-to u0 (map-get? total-donations-per-pool pool-id)))
    (donor-entry (default-to { amount: u0, timestamp: u0 } (map-get? donations { pool-id: pool-id, donor: tx-sender })))
    (min-don (get min-donation pool))
    (max-don (get max-donation pool))
    (token-principal (contract-of token))
    (recipient (as-contract tx-sender))
    (balance (unwrap! (contract-call? token get-balance tx-sender) (err ERR-TRANSFER-FAILED)))
  )
    (asserts! (is-eq token-principal (get token-contract pool)) (err ERR-INVALID-TOKEN))
    (asserts! (get status pool) (err ERR-INVALID-STATUS))
    (asserts! (>= amount min-don) (err ERR-INVALID-AMOUNT))
    (asserts! (<= amount max-don) (err ERR-INVALID-AMOUNT))
    (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (try! (contract-call? token transfer recipient amount))
    (map-set donations { pool-id: pool-id, donor: tx-sender }
      { amount: (+ (get amount donor-entry) amount), timestamp: block-height }
    )
    (map-set total-donations-per-pool pool-id (+ current-total amount))
    (map-set pools pool-id (merge pool { total-donations: (+ (get total-donations pool) amount) }))
    (print { event: "donation-made", pool-id: pool-id, donor: tx-sender, amount: amount })
    (ok true)
  )
)

(define-public (update-pool
  (pool-id uint)
  (update-name (string-utf8 100))
  (update-min-donation uint)
  (update-max-donation uint)
)
  (let ((pool (map-get? pools pool-id)))
    (match pool
      p
      (begin
        (asserts! (is-eq (get creator p) tx-sender) (err ERR-NOT-AUTHORIZED))
        (try! (validate-name update-name))
        (try! (validate-min-donation update-min-donation))
        (try! (validate-max-donation update-max-donation))
        (let ((existing (map-get? pools-by-name update-name)))
          (match existing
            existing-id
            (asserts! (is-eq existing-id pool-id) (err ERR-POOL-ALREADY-EXISTS))
            (ok true)
          )
        )
        (let ((old-name (get name p)))
          (if (is-eq old-name update-name)
            (ok true)
            (begin
              (map-delete pools-by-name old-name)
              (map-set pools-by-name update-name pool-id)
              (ok true)
            )
          )
        )
        (map-set pools pool-id
          (merge p {
            name: update-name,
            min-donation: update-min-donation,
            max-donation: update-max-donation,
            timestamp: block-height
          })
        )
        (map-set pool-updates pool-id
          {
            update-name: update-name,
            update-min-donation: update-min-donation,
            update-max-donation: update-max-donation,
            update-timestamp: block-height,
            updater: tx-sender
          }
        )
        (print { event: "pool-updated", id: pool-id })
        (ok true)
      )
      (err ERR-POOL-NOT-FOUND)
    )
  )
)

(define-public (get-pool-count)
  (ok (var-get next-pool-id))
)

(define-public (check-pool-existence (name (string-utf8 100)))
  (ok (is-pool-registered name))
)