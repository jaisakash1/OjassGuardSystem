import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { Guard } from "../models/guard.model.js";
import { Location } from "../models/locations.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import fs from "fs";

const generateAccessAndRefreshTokens = async (guardId) => {
  const guard = await Guard.findById(guardId);
  if (!guard) throw new ApiError(404, "Guard not found");

  const accessToken = guard.generateAccessToken();
  const refreshToken = guard.generateRefreshToken();

  guard.refreshToken = refreshToken;
  await guard.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

const registerGuard = asyncHandler(async (req, res) => {
  const {
    userName,
    fullName,
    email,
    password,
    residence,
    description,
    age,
    workHistory,
  } = req.body;

  if (
    !userName ||
    !fullName ||
    !email ||
    !password ||
    !residence ||
    !description ||
    !age
  ) {
    throw new ApiError(400, "All fields are required");
  }

  const existingGuard = await Guard.findOne({ $or: [{ userName }, { email }] });
  if (existingGuard) throw new ApiError(409, "Guard already exists");

  // Handle avatar upload
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  if (!avatarLocalPath) throw new ApiError(400, "Avatar image is required");

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  if (!avatar) throw new ApiError(500, "Failed to upload avatar");

  // Validate workHistory
  let parsedWorkHistory = [];
  if (workHistory) {
    try {
      parsedWorkHistory = JSON.parse(workHistory); // Ensure it's an array
      if (!Array.isArray(parsedWorkHistory)) throw new Error();
    } catch (error) {
      throw new ApiError(
        400,
        "Invalid workHistory format. Must be a JSON array."
      );
    }
  }

  const guard = await Guard.create({
    userName: userName.toLowerCase(),
    fullName,
    email,
    password,
    avatar: avatar.url,
    residence,
    description,
    age,
    workHistory: parsedWorkHistory, // Add work history here
  });

  const createdGuard = await Guard.findById(guard._id).select(
    "-password -refreshToken"
  );
  if (!createdGuard) throw new ApiError(500, "Guard registration failed");

  res
    .status(201)
    .json(new ApiResponse(201, createdGuard, "Guard registered successfully"));
});

const loginGuard = asyncHandler(async (req, res) => {
  const { email, password, userName } = req.body;

  if (!email && !userName)
    throw new ApiError(400, "Provide either username or email");

  const guard = await Guard.findOne({ $or: [{ userName }, { email }] }).select(
    "+password +refreshToken"
  );
  if (!guard) throw new ApiError(404, "Guard not found");

  const isMatch = await guard.isPasswordCorrect(password);
  if (!isMatch) throw new ApiError(401, "Invalid credentials");

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    guard._id
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
        { guard, accessToken, refreshToken },
        "Login successful"
      )
    );
});

const logoutGuard = asyncHandler(async (req, res) => {
  console.log(req.user);
  await Guard.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
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
  res.status(200).json(new ApiResponse(200, {}, "Guard logged out"));
});

const getAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body.refreshToken;
  if (!incomingRefreshToken) throw new ApiError(401, "Unauthorized request");

  try {
    const decoded = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );
    const guard = await Guard.findById(decoded._id).select("+refreshToken");

    if (!guard || incomingRefreshToken !== guard.refreshToken) {
      throw new ApiError(403, "Invalid or expired refresh token");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
      guard._id
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

const getCurrentGuard = asyncHandler(async (req, res) => {
  res
    .status(200)
    .json(
      new ApiResponse(200, req.user, "Current guard retrieved successfully")
    );
});

const checkRefreshToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body.refreshToken;
  res
    .status(incomingRefreshToken ? 200 : 401)
    .json({ status: incomingRefreshToken ? 200 : 401 });
});

const getGuard = asyncHandler(async (req, res) => {
  const { userName } = req.params;
  if (!userName) throw new ApiError(400, "Username is required");

  const guard = await Guard.findOne({ userName: userName.trim() }).select(
    "-password -refreshToken"
  );
  if (!guard) throw new ApiError(404, "Guard not found");

  res
    .status(200)
    .json(new ApiResponse(200, guard, "Guard retrieved successfully"));
});

const listAutherisedGuards = asyncHandler(async (req, res) => {
  const authorisedGuards = await Guard.find({ isApproved: true }).select(
    "-password -refreshToken"
  );

  if (!authorisedGuards.length)
    throw new ApiError(404, "No unauthorised guards found");

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        authorisedGuards,
        "Authorised guards retrieved successfully"
      )
    );
});

const listUnassignedGuards = asyncHandler(async (req, res) => {
  const data = await Guard.aggregate([
    // {
    //   $match: {
    //     isApproved: true, // Only fetch approved guards
    //   },
    // },
    {
      $lookup: {
        from: "locations", // Refers to the 'Location' collection
        localField: "_id",
        foreignField: "guard",
        as: "assignedLocations",
      },
    },
    {
      $match: {
        assignedLocations: { $size: 0 }, // Filters out guards who have at least one assigned location
      },
    },
    {
      $project: {
        password: 0,
        refreshToken: 0,
        assignedLocations: 0, // Exclude unnecessary fields
      },
    },
  ]);

  if (!data.length) {
    throw new ApiError(404, "No unassigned guards found");
  }

  res
    .status(200)
    .json(
      new ApiResponse(200, data, "Unassigned guards retrieved successfully")
    );
});

const listAuthorisedGuards = asyncHandler(async (req, res) => {
  const data = await Location.aggregate([
    {
      $lookup: {
        from: "guards", // Reference to the 'Guard' collection
        localField: "guard",
        foreignField: "_id",
        as: "guardDetails",
      },
    },
    {
      $unwind: "$guardDetails", // Convert array result from $lookup into an object
    },
    {
      $match: {
        "guardDetails.isApproved": true, // Only include approved guards
      },
    },
    {
      $project: {
        "guardDetails.password": 0,
        "guardDetails.refreshToken": 0, // Exclude sensitive fields
      },
    },
  ]);

  if (!data.length) {
    throw new ApiError(404, "No authorised guards found");
  }

  res
    .status(200)
    .json(
      new ApiResponse(200, data, "Authorised guards retrieved successfully")
    );
});

const getSingleGuardAssignment = asyncHandler(async (req, res) => {
  const guardId = req.user?._id;
  if (!guardId) {
    throw new ApiError(404, "NOT AUTHENTICATED");
  }

  const deployment = await Location.aggregate([
    {
      $match: {
        guard: guardId,
      },
    },
  ]);

  if (!deployment || deployment.length === 0) {
    throw new ApiError(404, "Deployment not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, deployment, "Found deployment"));
});

const updateWorkPercent = asyncHandler(async (req, res) => {
  const guardId = req.user?._id;
  if (!guardId) {
    throw new ApiError(404, "Guard not found or not authenticated");
  }

  const { workPercent } = req.body;
  if (workPercent === undefined || workPercent < 0 || workPercent > 100) {
    throw new ApiError(
      400,
      "Invalid work percent value (must be between 0-100)"
    );
  }

  const updatedGuard = await Guard.findByIdAndUpdate(
    guardId,
    { workPercent },
    { new: true }
  ).select("-password -refreshToken");

  if (!updatedGuard) {
    throw new ApiError(500, "Failed to update work percent");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, updatedGuard, "Work percent updated successfully")
    );
});

export {
  registerGuard,
  loginGuard,
  logoutGuard,
  getAccessToken,
  getCurrentGuard,
  checkRefreshToken,
  getGuard,
  listAutherisedGuards,
  listUnassignedGuards,
  listAuthorisedGuards,
  getSingleGuardAssignment,
  updateWorkPercent,
};
