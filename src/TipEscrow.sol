// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title TipEscrow
/// @notice Escrows native DOGE tips for X accounts, keyed by the account's immutable numeric id (handles
///         can be renamed and reused, ids cannot). A trusted off-chain verifier (a Supabase Edge Function
///         that has checked the claimant's X login) signs an EIP-712 `Claim` binding the X id to a payout
///         address; anyone may submit it. Tips not claimed within `refundDelay` can be refunded to the tipper.
/// @dev    Hackathon reference implementation, not audited. One verifier key, rotatable by the (fixed) owner.
///         The owner cannot touch escrowed funds, but whoever controls the verifier key can authorise a claim
///         for ANY X id, so the key and the owner key are both high-value.
contract TipEscrow {
    enum Status {
        None,
        Pending,
        Claimed,
        Refunded
    }

    struct Tip {
        bytes32 idHash;
        address tipper;
        uint64 createdAt;
        bool refunded;
        uint256 amount;
    }

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(uint256 xId,address recipient,uint256 nonce,uint256 expiry)");
    bytes32 private constant NAME_HASH = keccak256("TipEscrow");
    bytes32 private constant VERSION_HASH = keccak256("1");
    // secp256k1n / 2: signatures with a higher s are rejected (EIP-2 malleability)
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    /// @notice Only account allowed to rotate the verifier. Fixed at deployment (no transfer function).
    address public immutable owner;
    /// @notice Seconds after a tip before its tipper may refund it if still unclaimed.
    uint256 public immutable refundDelay;
    /// @notice Smallest tip accepted, in wei. Protects recipients from dust tips that cost more to claim than they pay.
    uint256 public immutable minTip;

    // Storage layout is relied on by scripts/tipescrow-e2e.cjs (state override): balanceOf must stay slot 0 and
    // verifier slot 5 (check with `forge inspect src/TipEscrow.sol:TipEscrow storageLayout`).
    /// @notice Unclaimed, unrefunded DOGE held for an X account, keyed by `idHash(xId)`.
    mapping(bytes32 idHash => uint256) public balanceOf;
    mapping(bytes32 idHash => mapping(uint256 nonce => bool)) public nonceUsed;
    mapping(uint256 tipId => Tip) public tips;
    /// @notice Tips for an account with tipId below this value were paid out by a claim.
    mapping(bytes32 idHash => uint256) public sweptBefore;
    /// @notice Number of tips ever made; ids run 1..tipCount.
    uint256 public tipCount;
    /// @notice Address whose EIP-712 signature authorises a claim. Rotatable via `setVerifier`.
    address public verifier;

    event Tipped(uint256 indexed tipId, bytes32 indexed idHash, address indexed from, uint256 amount);
    event Claimed(bytes32 indexed idHash, address indexed recipient, uint256 amount, uint256 nonce, uint256 xId);
    event Refunded(uint256 indexed tipId, bytes32 indexed idHash, address indexed tipper, uint256 amount);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    error ZeroValue();
    error BelowMinTip();
    error ZeroAddress();
    error NotOwner();
    error Expired();
    error NonceUsed();
    error BadSignature();
    error NothingToClaim();
    error UnknownTip();
    error NotTipper();
    error AlreadyRefunded();
    error AlreadyClaimed();
    error TooEarly();
    error TransferFailed();

    constructor(address owner_, address verifier_, uint256 refundDelay_, uint256 minTip_) {
        if (owner_ == address(0) || verifier_ == address(0)) revert ZeroAddress();
        owner = owner_;
        verifier = verifier_;
        refundDelay = refundDelay_;
        minTip = minTip_;
    }

    /// @notice Replace the verifier key (e.g. after a leak). Claims signed by the old key stop working immediately;
    ///         escrowed tips, nonces and refunds are unaffected.
    function setVerifier(address newVerifier) external {
        if (msg.sender != owner) revert NotOwner();
        if (newVerifier == address(0)) revert ZeroAddress();
        emit VerifierUpdated(verifier, newVerifier);
        verifier = newVerifier;
    }

    /// @notice Tip the owner of an X account. `idHash` = `idHash(xId)`.
    function tip(bytes32 idHash_) external payable returns (uint256 tipId) {
        if (msg.value == 0) revert ZeroValue();
        if (msg.value < minTip) revert BelowMinTip();
        tipId = ++tipCount;
        tips[tipId] = Tip(idHash_, msg.sender, uint64(block.timestamp), false, msg.value);
        balanceOf[idHash_] += msg.value;
        emit Tipped(tipId, idHash_, msg.sender, msg.value);
    }

    /// @notice Pay out every pending tip for X account `xId` to `recipient`, authorised by the verifier's signature.
    function claim(uint256 xId, address recipient, uint256 nonce, uint256 expiry, bytes calldata signature) external {
        if (block.timestamp > expiry) revert Expired();
        if (recipient == address(0)) revert ZeroAddress();
        bytes32 h = idHash(xId);
        if (nonceUsed[h][nonce]) revert NonceUsed();
        if (_recover(claimDigest(xId, recipient, nonce, expiry), signature) != verifier) revert BadSignature();

        uint256 amount = balanceOf[h];
        if (amount == 0) revert NothingToClaim();

        nonceUsed[h][nonce] = true;
        balanceOf[h] = 0;
        sweptBefore[h] = tipCount + 1; // every tip made so far is now settled
        emit Claimed(h, recipient, amount, nonce, xId);

        _send(recipient, amount);
    }

    /// @notice Return an unclaimed tip to its tipper once `refundDelay` has passed.
    function refund(uint256 tipId) external {
        Tip storage t = tips[tipId];
        if (t.tipper == address(0)) revert UnknownTip();
        if (msg.sender != t.tipper) revert NotTipper();
        if (t.refunded) revert AlreadyRefunded();
        if (tipId < sweptBefore[t.idHash]) revert AlreadyClaimed();
        if (block.timestamp < uint256(t.createdAt) + refundDelay) revert TooEarly();

        uint256 amount = t.amount;
        t.refunded = true;
        balanceOf[t.idHash] -= amount;
        emit Refunded(tipId, t.idHash, msg.sender, amount);

        _send(msg.sender, amount);
    }

    function tipStatus(uint256 tipId) public view returns (Status) {
        Tip storage t = tips[tipId];
        if (t.tipper == address(0)) return Status.None;
        if (t.refunded) return Status.Refunded;
        if (tipId < sweptBefore[t.idHash]) return Status.Claimed;
        return Status.Pending;
    }

    /// @notice Earliest timestamp at which the tipper can refund `tipId` (0 for an unknown tip).
    function refundableAt(uint256 tipId) external view returns (uint256) {
        Tip storage t = tips[tipId];
        return t.tipper == address(0) ? 0 : uint256(t.createdAt) + refundDelay;
    }

    /// @notice Storage key for an X account: keccak256 of the numeric X user id as a 32-byte big-endian word.
    function idHash(uint256 xId) public pure returns (bytes32) {
        return keccak256(abi.encode(xId));
    }

    /// @dev Computed per call (not cached) so the domain always binds the live chainId and address.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function claimDigest(uint256 xId, address recipient, uint256 nonce, uint256 expiry) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, xId, recipient, nonce, expiry));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address signer) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }
}
