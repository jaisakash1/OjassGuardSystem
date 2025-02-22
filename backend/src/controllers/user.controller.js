import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { Guard } from "../models/guard.model.js";
import { Complain } from "../models/complain.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Appreciation } from "../models/appreciation.model.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { isValidObjectId } from "mongoose";
import fs from "fs";

/**
 * Generates Access & Refresh Tokens and updates in DB
 */
const generateAccessAndRefreshTokens = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

/**
 * Registers a new user
 */
const registerUser = asyncHandler(async (req, res) => {
  const { userName, fullName, email, password, role = "user" } = req.body;

  if (!userName || !fullName || !email || !password) {
    throw new ApiError(400, "All fields are required");
  }
  // if (!role) role = "user";
  const existingUser = await User.findOne({ $or: [{ userName }, { email }] });
  if (existingUser) throw new ApiError(409, "User already exists");

  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  if (!avatarLocalPath) throw new ApiError(400, "Avatar image is required");

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  if (!avatar) throw new ApiError(500, "Failed to upload avatar");

  const user = await User.create({
    userName: userName.toLowerCase(),
    fullName,
    email,
    password,
    avatar: avatar.url,
    role: role,
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );
  if (!createdUser) throw new ApiError(500, "User registration failed");

  res
    .status(201)
    .json(new ApiResponse(201, createdUser, "User registered successfully"));
});

/**
 * Logs in a user
 */
const loginUser = asyncHandler(async (req, res) => {
  const { email, password, userName } = req.body;

  if (!email && !userName)
    throw new ApiError(400, "Provide either username or email");

  const user = await User.findOne({ $or: [{ userName }, { email }] }).select(
    "+password +refreshToken"
  );
  if (!user) throw new ApiError(404, "User not found");

  const isMatch = await user.isPasswordCorrect(password);
  if (!isMatch) throw new ApiError(401, "Invalid credentials");

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: 230 * 24 * 60 * 60 * 1000,
  });
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
  });

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user, accessToken, refreshToken },
        "Login successful"
      )
    );
});

/**
 * Logs out a user
 */
const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });

  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
  });
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
  });

  res.status(200).json(new ApiResponse(200, {}, "User logged out"));
});

/**
 * Generates a new access token using the refresh token
 */
const getAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body.refreshToken;
  if (!incomingRefreshToken) throw new ApiError(401, "Unauthorized request");

  try {
    const decoded = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );
    const user = await User.findById(decoded._id).select("+refreshToken");

    if (!user || incomingRefreshToken !== user.refreshToken) {
      throw new ApiError(403, "Invalid or expired refresh token");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
      user._id
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 230 * 24 * 60 * 60 * 1000,
    });
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken },
          "Access token refreshed successfully"
        )
      );
  } catch (error) {
    throw new ApiError(401, "Invalid refresh token");
  }
});

/**
 * Retrieves the current logged-in user
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  res
    .status(200)
    .json(
      new ApiResponse(200, req.user, "Current user retrieved successfully")
    );
});

/**
 * Checks if a refresh token exists
 */
const checkRefreshToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body.refreshToken;
  res
    .status(incomingRefreshToken ? 200 : 401)
    .json({ status: incomingRefreshToken ? 200 : 401 });
});

/**
 * Retrieves a user by username
 */

const authoriseGuard = asyncHandler(async (req, res) => {
  const { complain } = req.body;
  if (!complain) {
    throw new ApiError(400, "You must provide feedback");
  }

  let { guardId } = req.params;
  if (!guardId) throw new ApiError(400, "Guard ID is missing");

  // ✅ Check if guardId is a valid ObjectId, if not, create a valid one
  if (!mongoose.isValidObjectId(guardId)) {
    guardId = new mongoose.Types.ObjectId(); // Generates a valid ObjectId
  }

  const guard = await Guard.findById(guardId);
  if (!guard) throw new ApiError(404, "Guard not found");

  guard.isApproved = false;
  await guard.save();

  const comp = await Complain.create({
    complain,
    guard: guardId,
  });

  res
    .status(200)
    .json(
      new ApiResponse(200, guard, "Guard authorisation requested successfully")
    );
});

const getUser = asyncHandler(async (req, res) => {
  const { userName } = req.params;
  if (!userName) throw new ApiError(400, "Username is required");

  const user = await User.findOne({ userName: userName.trim() }).select(
    "-password -refreshToken"
  );
  if (!user) throw new ApiError(404, "User not found");

  res
    .status(200)
    .json(new ApiResponse(200, user, "User retrieved successfully"));
});

const appreciateGuard = asyncHandler(async (req, res) => {
  if (!req?.user?._id) {
    throw new ApiError(400, "Your ID is missing");
  }

  const { message } = req.body; // Changed `complain` to `message`
  if (!message) {
    throw new ApiError(400, "You must provide appreciation feedback");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    throw new ApiError(400, "User not found");
  }

  const { guardId } = req.params;
  if (!guardId) throw new ApiError(400, "Guard ID is missing");

  const guard = await Guard.findById(guardId);
  if (!guard) throw new ApiError(404, "Guard not found");

  // Instead of flagging the guard as unauthorized, we just record appreciation
  const appreciation = await Appreciation.create({
    message: message,
    guard: guardId,
  });

  res
    .status(200)
    .json(new ApiResponse(200, appreciation, "Guard appreciated successfully"));
});

export {
  registerUser,
  loginUser,
  logoutUser,
  getAccessToken,
  getCurrentUser,
  checkRefreshToken,
  getUser,
  authoriseGuard,
  appreciateGuard,
};
