// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {TipEscrow} from "../src/TipEscrow.sol";

/// Shared setup + an independent EIP-712 / key encoder (deliberately not using the contract's own helpers).
abstract contract TipEscrowBase is Test {
    uint256 constant REFUND_DELAY = 7 days;
    uint256 constant MIN_TIP = 0.1 ether;
    uint256 verifierPk = 0xA11CE;
    address verifier;
    TipEscrow escrow;

    function _deploy() internal {
        verifier = vm.addr(verifierPk);
        escrow = new TipEscrow(address(this), verifier, REFUND_DELAY, MIN_TIP);
    }

    function _key(uint256 xId) internal pure returns (bytes32) {
        return keccak256(abi.encode(xId));
    }

    function _digest(uint256 xId, address to, uint256 nonce, uint256 expiry) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("TipEscrow"),
                keccak256("1"),
                block.chainid,
                address(escrow)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Claim(uint256 xId,address recipient,uint256 nonce,uint256 expiry)"), xId, to, nonce, expiry
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, uint256 xId, address to, uint256 nonce, uint256 expiry)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(xId, to, nonce, expiry));
        return abi.encodePacked(r, s, v);
    }
}

contract TipEscrowTest is TipEscrowBase {
    address tipper = makeAddr("tipper");
    address tipper2 = makeAddr("tipper2");
    address payable recipient = payable(makeAddr("recipient"));

    uint256 constant X_ID = 2244994945; // @XDevelopers' id from X's docs
    uint256 constant OTHER_ID = 1850123456789012345; // a recent-style 19-digit id (> 2^53, so never a JS Number)
    bytes32 key = keccak256(abi.encode(X_ID));
    bytes32 otherKey = keccak256(abi.encode(OTHER_ID));

    function setUp() public {
        _deploy();
        vm.deal(tipper, 100 ether);
        vm.deal(tipper2, 100 ether);
    }

    function _tip(address from, bytes32 k, uint256 amount) internal returns (uint256 id) {
        vm.prank(from);
        id = escrow.tip{value: amount}(k);
    }

    function _claimAll(uint256 nonce) internal returns (uint256 expiry) {
        expiry = block.timestamp + 1 hours;
        escrow.claim(X_ID, recipient, nonce, expiry, _sign(verifierPk, X_ID, recipient, nonce, expiry));
    }

    // ---------------------------------------------------------------- constructor / key / digest

    function test_Constructor() public view {
        assertEq(escrow.owner(), address(this));
        assertEq(escrow.verifier(), verifier);
        assertEq(escrow.refundDelay(), REFUND_DELAY);
        assertEq(escrow.minTip(), MIN_TIP);
    }

    function test_ConstructorZeroAddressesRevert() public {
        vm.expectRevert(TipEscrow.ZeroAddress.selector);
        new TipEscrow(address(this), address(0), 1 days, 0);
        vm.expectRevert(TipEscrow.ZeroAddress.selector);
        new TipEscrow(address(0), verifier, 1 days, 0);
    }

    function test_RefundDelayIsConstructorParam() public {
        assertEq(new TipEscrow(address(this), verifier, 600, 0).refundDelay(), 600); // hackathon deployment value
        assertEq(new TipEscrow(address(this), verifier, 7 days, 0).refundDelay(), 7 days); // code default
    }

    // ---------------------------------------------------------------- minimum tip

    function test_TipBelowMinReverts() public {
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.BelowMinTip.selector);
        escrow.tip{value: MIN_TIP - 1}(key);
        assertEq(escrow.tipCount(), 0); // nothing recorded
        assertEq(address(escrow).balance, 0);
    }

    function test_TipExactlyMinWorks() public {
        _tip(tipper, key, MIN_TIP);
        assertEq(escrow.balanceOf(key), MIN_TIP);
    }

    function test_ZeroTipRevertsAsZeroValueEvenWithMin() public {
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.ZeroValue.selector);
        escrow.tip{value: 0}(key);
    }

    function test_MinTipZeroAllowsOneWei() public {
        TipEscrow open = new TipEscrow(address(this), verifier, REFUND_DELAY, 0);
        vm.prank(tipper);
        open.tip{value: 1}(key);
        assertEq(open.balanceOf(key), 1);
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.ZeroValue.selector); // zero is still never a tip
        open.tip{value: 0}(key);
    }

    /// The hackathon deployment: 600 s refund delay, 5 DOGE minimum.
    function test_HackathonParameters() public {
        TipEscrow h = new TipEscrow(address(this), verifier, 600, 5 ether);
        assertEq(h.refundDelay(), 600);
        assertEq(h.minTip(), 5 ether);
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.BelowMinTip.selector);
        h.tip{value: 5 ether - 1}(key);
        vm.prank(tipper);
        uint256 id = h.tip{value: 5 ether}(key);
        vm.warp(block.timestamp + 600);
        vm.prank(tipper);
        h.refund(id); // refundable after exactly 600 s
        assertEq(h.balanceOf(key), 0);
    }

    function testFuzz_MinTipBoundary(uint256 min, uint256 amount) public {
        min = bound(min, 1, 50 ether);
        amount = bound(amount, 1, 100 ether);
        TipEscrow t = new TipEscrow(address(this), verifier, REFUND_DELAY, min);
        vm.deal(tipper, amount);
        vm.prank(tipper);
        if (amount < min) vm.expectRevert(TipEscrow.BelowMinTip.selector);
        t.tip{value: amount}(key);
        assertEq(t.balanceOf(key), amount < min ? 0 : amount);
    }

    function test_MinTipDoesNotAffectClaimOrRefund() public {
        // a tip exactly at the minimum can be claimed and refunded like any other
        uint256 id = _tip(tipper, key, MIN_TIP);
        vm.warp(block.timestamp + REFUND_DELAY);
        vm.prank(tipper);
        escrow.refund(id);
        _tip(tipper2, key, MIN_TIP);
        _claimAll(1);
        assertEq(recipient.balance, MIN_TIP);
    }

    function test_IdHashIsKeccakOfWord() public view {
        assertEq(escrow.idHash(X_ID), key);
        assertEq(escrow.idHash(X_ID), keccak256(abi.encodePacked(bytes32(X_ID)))); // 32-byte big-endian word
        assertEq(escrow.idHash(0), keccak256(new bytes(32)));
    }

    function testFuzz_IdHashDistinctPerId(uint256 a, uint256 b) public view {
        vm.assume(a != b);
        assertTrue(escrow.idHash(a) != escrow.idHash(b));
    }

    function test_DigestMatchesIndependentEncoding() public view {
        assertEq(escrow.claimDigest(X_ID, recipient, 1, 1000), _digest(X_ID, recipient, 1, 1000));
    }

    function test_DigestBindsChainId() public {
        bytes32 before_ = escrow.claimDigest(X_ID, recipient, 1, 1000);
        vm.chainId(block.chainid + 1);
        assertTrue(escrow.claimDigest(X_ID, recipient, 1, 1000) != before_);
    }

    // ---------------------------------------------------------------- tip

    function test_Tip() public {
        vm.expectEmit(true, true, true, true);
        emit TipEscrow.Tipped(1, key, tipper, 1 ether);
        uint256 id = _tip(tipper, key, 1 ether);

        assertEq(id, 1);
        assertEq(escrow.tipCount(), 1);
        assertEq(escrow.balanceOf(key), 1 ether);
        assertEq(address(escrow).balance, 1 ether);
        (bytes32 h, address from, uint64 at, bool refunded, uint256 amount) = escrow.tips(1);
        assertEq(h, key);
        assertEq(from, tipper);
        assertEq(at, block.timestamp);
        assertFalse(refunded);
        assertEq(amount, 1 ether);
        assertEq(uint8(escrow.tipStatus(1)), uint8(TipEscrow.Status.Pending));
    }

    function test_TipZeroReverts() public {
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.ZeroValue.selector);
        escrow.tip{value: 0}(key);
    }

    function test_TipsAccumulatePerAccount() public {
        _tip(tipper, key, 1 ether);
        _tip(tipper2, key, 2 ether);
        _tip(tipper, otherKey, 5 ether);
        assertEq(escrow.balanceOf(key), 3 ether);
        assertEq(escrow.balanceOf(otherKey), 5 ether);
        assertEq(escrow.tipCount(), 3);
    }

    // ---------------------------------------------------------------- claim

    function test_ValidClaim() public {
        _tip(tipper, key, 1 ether);
        _tip(tipper2, key, 0.5 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);

        vm.expectEmit(true, true, false, true);
        emit TipEscrow.Claimed(key, recipient, 1.5 ether, 1, X_ID);
        escrow.claim(X_ID, recipient, 1, expiry, sig);

        assertEq(recipient.balance, 1.5 ether);
        assertEq(escrow.balanceOf(key), 0);
        assertEq(address(escrow).balance, 0);
        assertTrue(escrow.nonceUsed(key, 1));
        assertEq(uint8(escrow.tipStatus(1)), uint8(TipEscrow.Status.Claimed));
        assertEq(uint8(escrow.tipStatus(2)), uint8(TipEscrow.Status.Claimed));
    }

    function testFuzz_ClaimAnyIdAndAmount(uint256 xId, uint96 amount, uint256 nonce) public {
        amount = uint96(bound(amount, MIN_TIP, 50 ether));
        vm.deal(tipper, amount);
        _tip(tipper, _key(xId), amount);
        uint256 expiry = block.timestamp + 1 hours;
        escrow.claim(xId, recipient, nonce, expiry, _sign(verifierPk, xId, recipient, nonce, expiry));
        assertEq(recipient.balance, amount);
        assertEq(address(escrow).balance, 0);
    }

    function test_AnyoneCanSubmitSignedClaim() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);
        vm.prank(makeAddr("relayer"));
        escrow.claim(X_ID, recipient, 1, expiry, sig);
        assertEq(recipient.balance, 1 ether); // pays the signed recipient, not the submitter
    }

    function test_ClaimLeavesOtherAccountsUntouched() public {
        _tip(tipper, key, 1 ether);
        _tip(tipper, otherKey, 4 ether);
        _claimAll(1);
        assertEq(escrow.balanceOf(otherKey), 4 ether);
        assertEq(address(escrow).balance, 4 ether);
        assertEq(uint8(escrow.tipStatus(2)), uint8(TipEscrow.Status.Pending));
    }

    function test_SignatureForOneIdCannotClaimAnother() public {
        _tip(tipper, key, 1 ether);
        _tip(tipper, otherKey, 4 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sigForX = _sign(verifierPk, X_ID, recipient, 1, expiry);
        vm.expectRevert(TipEscrow.BadSignature.selector);
        escrow.claim(OTHER_ID, recipient, 1, expiry, sigForX);
        assertEq(escrow.balanceOf(otherKey), 4 ether);
    }

    function test_TipAfterClaimCanBeClaimedAgainWithNewNonce() public {
        _tip(tipper, key, 1 ether);
        _claimAll(1);
        _tip(tipper2, key, 2 ether);
        assertEq(uint8(escrow.tipStatus(2)), uint8(TipEscrow.Status.Pending));
        _claimAll(2);
        assertEq(recipient.balance, 3 ether);
    }

    function test_ReplayedClaimFails() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);
        escrow.claim(X_ID, recipient, 1, expiry, sig);

        _tip(tipper, key, 1 ether); // new funds arrive; the old signature must not drain them
        vm.expectRevert(TipEscrow.NonceUsed.selector);
        escrow.claim(X_ID, recipient, 1, expiry, sig);
        assertEq(escrow.balanceOf(key), 1 ether);
    }

    function test_ExpiredClaimFails() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);
        vm.warp(expiry + 1);
        vm.expectRevert(TipEscrow.Expired.selector);
        escrow.claim(X_ID, recipient, 1, expiry, sig);
    }

    function test_ClaimAtExactExpirySucceeds() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);
        vm.warp(expiry);
        escrow.claim(X_ID, recipient, 1, expiry, sig);
        assertEq(recipient.balance, 1 ether);
    }

    function test_WrongSignerFails() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(0xBAD, X_ID, recipient, 1, expiry);
        vm.expectRevert(TipEscrow.BadSignature.selector);
        escrow.claim(X_ID, recipient, 1, expiry, sig);
    }

    function test_TamperedFieldsFail() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);

        vm.expectRevert(TipEscrow.BadSignature.selector); // recipient swapped
        escrow.claim(X_ID, payable(makeAddr("attacker")), 1, expiry, sig);
        vm.expectRevert(TipEscrow.BadSignature.selector); // nonce changed
        escrow.claim(X_ID, recipient, 2, expiry, sig);
        vm.expectRevert(TipEscrow.BadSignature.selector); // expiry extended
        escrow.claim(X_ID, recipient, 1, expiry + 1 days, sig);
        vm.expectRevert(TipEscrow.BadSignature.selector); // different account
        escrow.claim(X_ID + 1, recipient, 1, expiry, sig);
    }

    function test_SignatureForOtherContractFails() public {
        uint256 expiry = block.timestamp + 1 hours;
        TipEscrow other = new TipEscrow(address(this), verifier, REFUND_DELAY, MIN_TIP);
        bytes memory sigForThis = _sign(verifierPk, X_ID, recipient, 1, expiry);
        vm.prank(tipper);
        other.tip{value: 1 ether}(key);
        vm.expectRevert(TipEscrow.BadSignature.selector);
        other.claim(X_ID, recipient, 1, expiry, sigForThis);
    }

    function test_MalleableHighSFails() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierPk, _digest(X_ID, recipient, 1, expiry));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(TipEscrow.BadSignature.selector);
        escrow.claim(X_ID, recipient, 1, expiry, flipped);
    }

    function test_BadSignatureLengthAndVFail() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        vm.expectRevert(TipEscrow.BadSignature.selector);
        escrow.claim(X_ID, recipient, 1, expiry, hex"1234");
        (, bytes32 r, bytes32 s) = vm.sign(verifierPk, _digest(X_ID, recipient, 1, expiry));
        vm.expectRevert(TipEscrow.BadSignature.selector);
        escrow.claim(X_ID, recipient, 1, expiry, abi.encodePacked(r, s, uint8(1)));
    }

    function test_ClaimWithNothingToClaimReverts() public {
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);
        vm.expectRevert(TipEscrow.NothingToClaim.selector);
        escrow.claim(X_ID, recipient, 1, expiry, sig);
        assertFalse(escrow.nonceUsed(key, 1)); // revert must not burn the nonce
    }

    function test_ClaimToZeroAddressReverts() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, address(0), 1, expiry);
        vm.expectRevert(TipEscrow.ZeroAddress.selector);
        escrow.claim(X_ID, payable(address(0)), 1, expiry, sig);
    }

    function test_ClaimToRejectingRecipientReverts() public {
        _tip(tipper, key, 1 ether);
        address rejecter = address(new Rejecter());
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, rejecter, 1, expiry);
        vm.expectRevert(TipEscrow.TransferFailed.selector);
        escrow.claim(X_ID, rejecter, 1, expiry, sig);
        assertEq(escrow.balanceOf(key), 1 ether); // state rolled back, funds still escrowed
        assertFalse(escrow.nonceUsed(key, 1));
    }

    // ---------------------------------------------------------------- verifier rotation

    uint256 constant NEW_PK = 0xB0B;

    function test_SetVerifierByOwner() public {
        address newV = vm.addr(NEW_PK);
        vm.expectEmit(true, true, false, true);
        emit TipEscrow.VerifierUpdated(verifier, newV);
        escrow.setVerifier(newV);
        assertEq(escrow.verifier(), newV);
        assertEq(escrow.owner(), address(this)); // ownership unchanged
    }

    function test_SetVerifierNonOwnerFails() public {
        address newV = vm.addr(NEW_PK);
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.NotOwner.selector);
        escrow.setVerifier(newV);
        vm.prank(verifier); // the current verifier cannot rotate itself either
        vm.expectRevert(TipEscrow.NotOwner.selector);
        escrow.setVerifier(newV);
        vm.prank(recipient);
        vm.expectRevert(TipEscrow.NotOwner.selector);
        escrow.setVerifier(newV);
        assertEq(escrow.verifier(), verifier);
    }

    function test_SetVerifierZeroAddressReverts() public {
        vm.expectRevert(TipEscrow.ZeroAddress.selector);
        escrow.setVerifier(address(0));
        assertEq(escrow.verifier(), verifier);
    }

    function test_ClaimSignedByOldKeyFailsAfterRotation() public {
        _tip(tipper, key, 1 ether);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory oldSig = _sign(verifierPk, X_ID, recipient, 1, expiry); // valid right now
        escrow.setVerifier(vm.addr(NEW_PK));

        vm.expectRevert(TipEscrow.BadSignature.selector);
        escrow.claim(X_ID, recipient, 1, expiry, oldSig);
        assertEq(escrow.balanceOf(key), 1 ether); // funds stay escrowed
        assertFalse(escrow.nonceUsed(key, 1)); // and the nonce is not burned
    }

    function test_ClaimSignedByNewKeyWorksAfterRotation() public {
        _tip(tipper, key, 1 ether);
        escrow.setVerifier(vm.addr(NEW_PK));
        uint256 expiry = block.timestamp + 1 hours;
        escrow.claim(X_ID, recipient, 1, expiry, _sign(NEW_PK, X_ID, recipient, 1, expiry));
        assertEq(recipient.balance, 1 ether);
        assertEq(escrow.balanceOf(key), 0);
    }

    function test_RotationKeepsNoncesTipsAndRefunds() public {
        uint256 id1 = _tip(tipper, key, 1 ether);
        _claimAll(1); // old key, nonce 1
        uint256 id2 = _tip(tipper2, key, 2 ether);
        escrow.setVerifier(vm.addr(NEW_PK));

        uint256 expiry = block.timestamp + 1 hours;
        vm.expectRevert(TipEscrow.NonceUsed.selector); // a used nonce stays used under the new key
        escrow.claim(X_ID, recipient, 1, expiry, _sign(NEW_PK, X_ID, recipient, 1, expiry));

        vm.warp(block.timestamp + REFUND_DELAY);
        vm.prank(tipper2);
        escrow.refund(id2); // refunds don't depend on the verifier
        assertEq(uint8(escrow.tipStatus(id1)), uint8(TipEscrow.Status.Claimed));
        assertEq(uint8(escrow.tipStatus(id2)), uint8(TipEscrow.Status.Refunded));
    }

    function test_RotateBackToOldKeyWorks() public {
        _tip(tipper, key, 1 ether);
        escrow.setVerifier(vm.addr(NEW_PK));
        escrow.setVerifier(verifier);
        _claimAll(1);
        assertEq(recipient.balance, 1 ether);
    }

    function testFuzz_RotationInvalidatesOldKey(uint256 newPk, uint256 xId) public {
        newPk = bound(newPk, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(newPk != verifierPk);
        vm.deal(tipper, 1 ether);
        _tip(tipper, _key(xId), 1 ether);
        escrow.setVerifier(vm.addr(newPk));
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory oldSig = _sign(verifierPk, xId, recipient, 1, expiry);
        vm.expectRevert(TipEscrow.BadSignature.selector);
        escrow.claim(xId, recipient, 1, expiry, oldSig);
        escrow.claim(xId, recipient, 1, expiry, _sign(newPk, xId, recipient, 1, expiry));
        assertEq(recipient.balance, 1 ether);
    }

    // ---------------------------------------------------------------- refund

    function test_RefundAfterDelay() public {
        uint256 id = _tip(tipper, key, 2 ether);
        uint256 before_ = tipper.balance;
        assertEq(escrow.refundableAt(id), block.timestamp + REFUND_DELAY);
        vm.warp(block.timestamp + REFUND_DELAY);

        vm.expectEmit(true, true, true, true);
        emit TipEscrow.Refunded(id, key, tipper, 2 ether);
        vm.prank(tipper);
        escrow.refund(id);

        assertEq(tipper.balance, before_ + 2 ether);
        assertEq(escrow.balanceOf(key), 0);
        assertEq(address(escrow).balance, 0);
        assertEq(uint8(escrow.tipStatus(id)), uint8(TipEscrow.Status.Refunded));
    }

    function test_RefundBeforeDelayFails() public {
        uint256 id = _tip(tipper, key, 1 ether);
        vm.warp(block.timestamp + REFUND_DELAY - 1);
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.TooEarly.selector);
        escrow.refund(id);
        assertEq(escrow.balanceOf(key), 1 ether);
    }

    function test_RefundByNonTipperFails() public {
        uint256 id = _tip(tipper, key, 1 ether);
        vm.warp(block.timestamp + REFUND_DELAY);
        vm.prank(tipper2);
        vm.expectRevert(TipEscrow.NotTipper.selector);
        escrow.refund(id);
        vm.expectRevert(TipEscrow.NotTipper.selector); // not even the claimable account's recipient
        vm.prank(recipient);
        escrow.refund(id);
    }

    function test_RefundUnknownTipFails() public {
        vm.expectRevert(TipEscrow.UnknownTip.selector);
        escrow.refund(99);
        assertEq(uint8(escrow.tipStatus(99)), uint8(TipEscrow.Status.None));
        assertEq(escrow.refundableAt(99), 0);
    }

    function test_DoubleRefundFails() public {
        uint256 id = _tip(tipper, key, 1 ether);
        _tip(tipper2, key, 1 ether); // other funds in escrow must not be reachable by a 2nd refund
        vm.warp(block.timestamp + REFUND_DELAY);
        vm.startPrank(tipper);
        escrow.refund(id);
        vm.expectRevert(TipEscrow.AlreadyRefunded.selector);
        escrow.refund(id);
        vm.stopPrank();
        assertEq(escrow.balanceOf(key), 1 ether);
    }

    function test_RefundAfterClaimFails() public {
        uint256 id = _tip(tipper, key, 1 ether);
        _claimAll(1);
        vm.warp(block.timestamp + REFUND_DELAY);
        vm.prank(tipper);
        vm.expectRevert(TipEscrow.AlreadyClaimed.selector);
        escrow.refund(id);
        assertEq(recipient.balance, 1 ether); // claimant keeps the money
    }

    function test_RefundOfTipMadeAfterClaimWorks() public {
        _tip(tipper, key, 1 ether);
        _claimAll(1);
        uint256 id2 = _tip(tipper2, key, 3 ether);
        vm.warp(block.timestamp + REFUND_DELAY);
        vm.prank(tipper2);
        escrow.refund(id2);
        assertEq(escrow.balanceOf(key), 0);
    }

    function test_ClaimAfterRefundFails() public {
        uint256 id = _tip(tipper, key, 1 ether);
        vm.warp(block.timestamp + REFUND_DELAY);
        vm.prank(tipper);
        escrow.refund(id);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, recipient, 1, expiry);
        vm.expectRevert(TipEscrow.NothingToClaim.selector); // refunded money is gone from the claimable balance
        escrow.claim(X_ID, recipient, 1, expiry, sig);
        assertEq(recipient.balance, 0);
        assertFalse(escrow.nonceUsed(key, 1));
    }

    function test_ClaimAfterPartialRefundPaysOnlyRemainder() public {
        uint256 id = _tip(tipper, key, 1 ether);
        vm.warp(block.timestamp + REFUND_DELAY);
        _tip(tipper2, key, 2 ether); // fresh tip, not yet refundable
        vm.prank(tipper);
        escrow.refund(id);

        _claimAll(1);
        assertEq(recipient.balance, 2 ether);
        assertEq(address(escrow).balance, 0);
    }

    // ---------------------------------------------------------------- reentrancy

    function test_ReentrantClaimRecipientCannotDoubleSpend() public {
        _tip(tipper, key, 1 ether);
        _tip(tipper, otherKey, 9 ether); // victim funds that a re-entrant call would target
        ReentrantRecipient attacker = new ReentrantRecipient(escrow);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, X_ID, address(attacker), 1, expiry);
        attacker.arm(X_ID, expiry, sig);

        escrow.claim(X_ID, address(attacker), 1, expiry, sig);

        assertTrue(attacker.attempted());
        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance, 1 ether);
        assertEq(address(escrow).balance, 9 ether);
    }

    function test_ReentrantRefundCannotDoubleSpend() public {
        ReentrantTipper t = new ReentrantTipper(escrow);
        vm.deal(address(t), 5 ether);
        uint256 id = t.tip{value: 1 ether}(key);
        _tip(tipper, key, 4 ether); // other tippers' funds
        vm.warp(block.timestamp + REFUND_DELAY);

        t.refund(id);

        assertTrue(t.attempted());
        assertFalse(t.reentrySucceeded());
        // t started with 5 (the 1 ether tip is forwarded from this test contract's balance, so t's own
        // 5 is untouched), plus exactly one 1 ether refund. A successful re-entry would make it 7.
        assertEq(address(t).balance, 6 ether);
        assertEq(escrow.balanceOf(key), 4 ether);
    }
}

contract Rejecter {
    receive() external payable {
        revert("no");
    }
}

contract ReentrantRecipient {
    TipEscrow immutable escrow;
    uint256 xId;
    uint256 expiry;
    bytes sig;
    bool public attempted;
    bool public reentrySucceeded;

    constructor(TipEscrow e) {
        escrow = e;
    }

    function arm(uint256 x, uint256 e, bytes memory s) external {
        xId = x;
        expiry = e;
        sig = s;
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try escrow.claim(xId, address(this), 1, expiry, sig) {
            reentrySucceeded = true;
        } catch {}
    }
}

contract ReentrantTipper {
    TipEscrow immutable escrow;
    uint256 id;
    bool public attempted;
    bool public reentrySucceeded;

    constructor(TipEscrow e) {
        escrow = e;
    }

    function tip(bytes32 k) external payable returns (uint256) {
        id = escrow.tip{value: msg.value}(k);
        return id;
    }

    function refund(uint256 tipId) external {
        escrow.refund(tipId);
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try escrow.refund(id) {
            reentrySucceeded = true;
        } catch {}
    }
}

/// Random sequences of tip / refund / claim / time travel must never leave the contract
/// holding more or less than it owes.
contract TipEscrowHandler is TipEscrowBase {
    address[3] actors;
    uint256[3] ids = [2244994945, 1850123456789012345, 7];
    bytes32[3] keys;
    uint256 nonce;

    uint256 public totalIn;
    uint256 public totalOut;
    bool public belowMinAccepted;

    constructor() {
        _deploy();
        for (uint256 i; i < 3; ++i) {
            actors[i] = makeAddr(string.concat("actor", vm.toString(i)));
            vm.deal(actors[i], 1_000_000 ether);
            keys[i] = _key(ids[i]);
        }
    }

    function escrowAddr() external view returns (TipEscrow) {
        return escrow;
    }

    function owed() external view returns (uint256 sum) {
        for (uint256 i; i < 3; ++i) {
            sum += escrow.balanceOf(keys[i]);
        }
    }

    function tip(uint256 who, uint256 idSeed, uint256 amount) external {
        amount = bound(amount, MIN_TIP, 100 ether);
        vm.prank(actors[who % 3]);
        escrow.tip{value: amount}(keys[idSeed % 3]);
        totalIn += amount;
    }

    /// Tries a tip strictly below the minimum (1 wei .. minTip - 1). It must always revert; if it ever lands, the
    /// money is counted in so conservation still holds and `belowMinAccepted` flags the guard failure.
    function tipBelowMin(uint256 who, uint256 idSeed, uint256 amount) external {
        amount = bound(amount, 1, MIN_TIP - 1);
        vm.prank(actors[who % 3]);
        try escrow.tip{value: amount}(keys[idSeed % 3]) {
            belowMinAccepted = true;
            totalIn += amount;
        } catch {}
    }

    function refund(uint256 who, uint256 tipSeed) external {
        uint256 n = escrow.tipCount();
        if (n == 0) return;
        uint256 id = (tipSeed % n) + 1;
        (, address from,,, uint256 amount) = escrow.tips(id);
        if (from != actors[who % 3]) return;
        if (escrow.tipStatus(id) != TipEscrow.Status.Pending) return;
        if (block.timestamp < escrow.refundableAt(id)) return;
        vm.prank(from);
        escrow.refund(id);
        totalOut += amount;
    }

    function claim(uint256 idSeed, uint256 recipientSeed) external {
        uint256 i = idSeed % 3;
        uint256 amount = escrow.balanceOf(keys[i]);
        if (amount == 0) return;
        address to = makeAddr(string.concat("recipient", vm.toString(recipientSeed % 4)));
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(verifierPk, ids[i], to, ++nonce, expiry);
        escrow.claim(ids[i], to, nonce, expiry, sig);
        totalOut += amount;
    }

    /// Rotate to a fresh key; later claims are signed with it. Accounting must be unaffected.
    function rotate(uint256 seed) external {
        uint256 pk = bound(seed, 1, 1_000_000);
        if (pk == verifierPk) return;
        escrow.setVerifier(vm.addr(pk));
        verifierPk = pk;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 10 days));
    }
}

contract TipEscrowInvariantTest is Test {
    TipEscrowHandler handler;
    TipEscrow escrow;

    function setUp() public {
        handler = new TipEscrowHandler();
        escrow = handler.escrowAddr();
        targetContract(address(handler));
    }

    /// The contract's native balance is exactly the sum of what it owes to accounts.
    function invariant_BalanceEqualsLiabilities() public view {
        assertEq(address(escrow).balance, handler.owed());
    }

    /// The minimum-tip guard: the handler keeps trying tips below `minTip`, and none may ever be accepted.
    function invariant_NoTipBelowMin() public view {
        assertFalse(handler.belowMinAccepted());
    }

    /// Conservation: everything paid in is either still held or was paid out.
    function invariant_Conservation() public view {
        assertEq(handler.totalIn(), handler.totalOut() + address(escrow).balance);
    }
}
