(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-PROPOSAL-NOT-FOUND u101)
(define-constant ERR-ESCROW-ALREADY-EXISTS u102)
(define-constant ERR-ESCROW-NOT-FOUND u103)
(define-constant ERR-ALREADY-RELEASED u104)
(define-constant ERR-NOT-RELEASED u105)
(define-constant ERR-INVALID-AMOUNT u106)
(define-constant ERR-TRANSFER-FAILED u107)
(define-constant ERR-TOKEN-NOT-WHITELISTED u108)
(define-constant ERR-INSUFFICIENT-BALANCE u109)
(define-constant ERR-PROPOSAL-INACTIVE u110)
(define-constant ERR-RECLAIM-NOT-ALLOWED u111)
(define-constant ERR-RECLAIM-TIMEOUT u112)
(define-constant ERR-INVALID-TOKEN u113)

(define-constant RECLAIM-TIMEOUT u5760)

(define-data-var admin principal tx-sender)
(define-data-var escrow-nonce uint u0)

(define-map whitelisted-tokens principal bool)
(define-map escrows
  uint
  {
    proposal-id: uint,
    amount: uint,
    token: principal,
    patroller: principal,
    donor: principal,
    released: bool,
    created-at: uint,
    reclaimable-at: uint
  }
)

(define-map proposal-status uint bool)

(define-read-only (get-escrow (escrow-id uint))
  (map-get? escrows escrow-id)
)

(define-read-only (is-token-whitelisted (token principal))
  (default-to false (map-get? whitelisted-tokens token))
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set admin new-admin)
    (ok true)
  )
)

(define-public (whitelist-token (token principal) (allowed bool))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (map-set whitelisted-tokens token allowed)
    (ok true)
  )
)

(define-public (set-proposal-active (proposal-id uint) (active bool))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (map-set proposal-status proposal-id active)
    (ok true)
  )
)

(define-public (lock-funds
    (proposal-id uint)
    (amount uint)
    (token principal)
    (patroller principal)
  )
  (let (
    (escrow-id (var-get escrow-nonce))
    (caller tx-sender)
    (is-active (default-to false (map-get? proposal-status proposal-id)))
  )
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (is-token-whitelisted token) (err ERR-TOKEN-NOT-WHITELISTED))
    (asserts! is-active (err ERR-PROPOSAL-INACTIVE))
    (asserts! (is-none (map-get? escrows escrow-id)) (err ERR-ESCROW-ALREADY-EXISTS))
    (try! (contract-call? token transfer amount caller (as-contract tx-sender) none))
    (map-set escrows escrow-id
      {
        proposal-id: proposal-id,
        amount: amount,
        token: token,
        patroller: patroller,
        donor: caller,
        released: false,
        created-at: block-height,
        reclaimable-at: (+ block-height RECLAIM-TIMEOUT)
      }
    )
    (var-set escrow-nonce (+ escrow-id u1))
    (ok escrow-id)
  )
)

(define-public (release-funds (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND))))
    (asserts! (not (get released escrow)) (err ERR-ALREADY-RELEASED))
    (asserts! (is-eq (get token escrow) .sip-010-token) (err ERR-INVALID-TOKEN))
    (try! (as-contract (contract-call? .sip-010-token transfer
        (get amount escrow)
        tx-sender
        (get patroller escrow)
        none
      )))
    (map-set escrows escrow-id (merge escrow { released: true }))
    (ok true)
  )
)

(define-public (reclaim-funds (escrow-id uint))
  (let (
    (escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND)))
    (caller tx-sender)
  )
    (asserts! (is-eq caller (get donor escrow)) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (get released escrow)) (err ERR-ALREADY-RELEASED))
    (asserts! (>= block-height (get reclaimable-at escrow)) (err ERR-RECLAIM-TIMEOUT))
    (try! (as-contract (contract-call? (get token escrow) transfer
        (get amount escrow)
        tx-sender
        caller
        none
      )))
    (map-delete escrows escrow-id)
    (ok true)
  )
)

(define-public (emergency-withdraw (token principal) (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (try! (as-contract (contract-call? token transfer amount tx-sender (var-get admin) none)))
    (ok true)
  )
)

(define-trait sip-010-trait
  ((transfer (uint principal principal (optional (buff 34))) (response bool uint)))
)